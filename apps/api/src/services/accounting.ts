import { createHash } from 'node:crypto';
import { TxError, type Db } from '../db/pool';

export interface AccountRow {
  id: string;
  participant_id: string;
  competition_id: string;
  allowance: string;
  consumed_tokens: string;
  reserved_tokens: string;
  account_state: 'OPEN' | 'FINALIZING' | 'CLOSED' | 'ACCOUNTING_INCIDENT';
  revision: string;
}

export interface UsageReceipt {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  providerRequestId?: string | null;
  rawUsage: unknown;
}

export function receiptHash(callId: string, receipt: UsageReceipt): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        callId,
        input: receipt.inputTokens,
        output: receipt.outputTokens,
        cached: receipt.cachedInputTokens ?? 0,
        reasoning: receipt.reasoningTokens ?? 0
      })
    )
    .digest('hex');
}

export function availableTokens(account: AccountRow): number {
  return Number(account.allowance) - Number(account.consumed_tokens) - Number(account.reserved_tokens);
}

/**
 * Locks the participant's account row. Every path that can change the balance
 * must take this lock, and only this lock, before touching ledger rows.
 */
export async function lockAccount(tx: Db, participantId: string): Promise<AccountRow> {
  const row = await tx.one<AccountRow>(
    `select * from participant_token_accounts where participant_id = $1 for update`,
    [participantId]
  );
  if (!row) throw new TxError('ACCOUNT_NOT_FOUND', 'No token account for this participant', 404);
  return row;
}

async function nextSequence(tx: Db, accountId: string): Promise<number> {
  const row = await tx.must<{ next: string }>(
    `select coalesce(max(sequence), 0) + 1 as next
       from token_ledger_events where account_id = $1`,
    [accountId]
  );
  return Number(row.next);
}

/**
 * Appends one ledger event and projects the balance. The caller must already
 * hold the account row lock.
 */
async function appendLedger(
  tx: Db,
  account: AccountRow,
  event: {
    type: 'RESERVE' | 'SETTLE' | 'RELEASE' | 'CORRECTION';
    consumedDelta?: number;
    reservedDelta?: number;
    callId?: string | null;
    receiptId?: string | null;
    reason?: string;
    nextState?: AccountRow['account_state'];
  }
): Promise<void> {
  const sequence = await nextSequence(tx, account.id);
  const consumedDelta = event.consumedDelta ?? 0;
  const reservedDelta = event.reservedDelta ?? 0;

  await tx.query(
    `insert into token_ledger_events
       (account_id, sequence, event_type, consumed_delta, reserved_delta, provider_call_id, receipt_id, reason)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [account.id, sequence, event.type, consumedDelta, reservedDelta, event.callId ?? null, event.receiptId ?? null, event.reason ?? null]
  );

  // account_state and the new balance move in one UPDATE so the
  // consumed + reserved <= allowance check is evaluated against the final row.
  await tx.query(
    `update participant_token_accounts
        set consumed_tokens = consumed_tokens + $2,
            reserved_tokens = reserved_tokens + $3,
            account_state = coalesce($4, account_state),
            revision = revision + 1,
            updated_at = now()
      where id = $1`,
    [account.id, consumedDelta, reservedDelta, event.nextState ?? null]
  );

  account.consumed_tokens = String(Number(account.consumed_tokens) + consumedDelta);
  account.reserved_tokens = String(Number(account.reserved_tokens) + reservedDelta);
  if (event.nextState) account.account_state = event.nextState;
}

/**
 * Holds `amount` tokens. Must be called inside the admission transaction while
 * the account lock is held.
 */
export async function reserveTokens(
  tx: Db,
  account: AccountRow,
  callId: string,
  amount: number,
  reason: string
): Promise<void> {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new TxError('INVALID_RESERVATION', 'Reservation must be a positive integer', 500);
  }
  if (account.account_state !== 'OPEN') {
    throw new TxError('WORKSPACE_SEALED', 'This workspace no longer accepts new generation', 409);
  }
  if (availableTokens(account) < amount) {
    throw new TxError(
      'BUDGET_EXHAUSTED',
      `This request needs ${amount} tokens but only ${availableTokens(account)} are available`,
      409,
      { required: amount, available: availableTokens(account) }
    );
  }

  await tx.query(
    `insert into token_reservations (provider_call_id, account_id, reserved_upper_bound, state)
     values ($1, $2, $3, 'HELD')`,
    [callId, account.id, amount]
  );
  await appendLedger(tx, account, {
    type: 'RESERVE',
    reservedDelta: amount,
    callId,
    reason
  });
}

/**
 * Settles a physical call exactly once from provider-reported usage.
 *
 * The receipt is the authority. If the provider reports more than the reserved
 * upper bound the guarantee has been breached: the true amount is recorded and
 * the account is frozen as ACCOUNTING_INCIDENT. The value is never clamped.
 */
export async function settleCall(
  tx: Db,
  callId: string,
  receipt: UsageReceipt
): Promise<{ settled: boolean; actual: number; incident: boolean }> {
  const call = await tx.one<{
    id: string;
    state: string;
    attempt_id: string | null;
    participant_id: string | null;
    reserved_tokens: string;
  }>(`select id, state, attempt_id, participant_id, reserved_tokens from provider_calls where id = $1 for update`, [
    callId
  ]);
  if (!call) throw new TxError('CALL_NOT_FOUND', 'Unknown provider call', 404);

  const already = await tx.one<{ id: string }>(
    `select id from token_ledger_events where provider_call_id = $1 and event_type = 'SETTLE'`,
    [callId]
  );
  if (already) {
    return { settled: false, actual: receipt.inputTokens + receipt.outputTokens, incident: false };
  }

  const reservation = await tx.must<{ id: string; account_id: string; reserved_upper_bound: string }>(
    `select id, account_id, reserved_upper_bound from token_reservations where provider_call_id = $1`,
    [callId]
  );

  const actual = receipt.inputTokens + receipt.outputTokens;
  const held = Number(reservation.reserved_upper_bound);
  const incident = actual > held;

  const accountRow = await tx.must<AccountRow>(
    `select * from participant_token_accounts where id = $1 for update`,
    [reservation.account_id]
  );

  const inserted = await tx.must<{ id: string }>(
    `insert into provider_usage_receipts
       (provider_call_id, provider_request_id, raw_usage, input_tokens, output_tokens, total_tokens,
        cached_input_tokens, reasoning_tokens, receipt_hash)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     returning id`,
    [
      callId,
      receipt.providerRequestId ?? null,
      JSON.stringify(receipt.rawUsage ?? {}),
      receipt.inputTokens,
      receipt.outputTokens,
      actual,
      receipt.cachedInputTokens ?? 0,
      receipt.reasoningTokens ?? 0,
      receiptHash(callId, receipt)
    ]
  );

  await appendLedger(tx, accountRow, {
    type: 'SETTLE',
    consumedDelta: actual,
    reservedDelta: -held,
    callId,
    receiptId: inserted.id,
    reason: incident ? 'PROVIDER_BOUND_BREACH' : 'PROVIDER_USAGE_SETTLED',
    nextState: incident ? 'ACCOUNTING_INCIDENT' : undefined
  });

  await tx.query(`update token_reservations set state = 'SETTLED' where id = $1`, [reservation.id]);
  await tx.query(`update provider_calls set state = 'COMPLETED' where id = $1`, [callId]);

  if (call.attempt_id) {
    await tx.query(
      `update attempt_states
          set accounting_state = 'SETTLED', updated_at = now()
        where attempt_id = $1`,
      [call.attempt_id]
    );
  }

  return { settled: true, actual, incident };
}

/**
 * Releases a hold for a call that is conclusively unbilled. Never used because
 * a timer expired, and never used to invent a zero.
 */
export async function releaseCall(tx: Db, callId: string, reason: string): Promise<void> {
  const reservation = await tx.one<{ id: string; account_id: string; reserved_upper_bound: string; state: string }>(
    `select id, account_id, reserved_upper_bound, state from token_reservations where provider_call_id = $1 for update`,
    [callId]
  );
  if (!reservation || reservation.state !== 'HELD') return;

  const account = await tx.must<AccountRow>(
    `select * from participant_token_accounts where id = $1 for update`,
    [reservation.account_id]
  );

  await appendLedger(tx, account, {
    type: 'RELEASE',
    reservedDelta: -Number(reservation.reserved_upper_bound),
    callId,
    reason
  });

  await tx.query(`update token_reservations set state = 'RELEASED' where id = $1`, [reservation.id]);
  await tx.query(`update provider_calls set state = 'REJECTED_UNBILLED' where id = $1`, [callId]);
}

export async function unresolvedCallCount(tx: Db, participantId: string): Promise<number> {
  const row = await tx.must<{ count: string }>(
    `select count(*)::text as count
       from provider_calls
      where participant_id = $1
        and purpose = 'GENERATION'
        and state in ('PENDING','DISPATCH_INTENT','DISPATCHED','FAILED_USAGE_PENDING')`,
    [participantId]
  );
  return Number(row.count);
}

export async function currentLedgerBoundary(tx: Db, accountId: string): Promise<number> {
  const row = await tx.must<{ boundary: string }>(
    `select coalesce(max(sequence), 0)::text as boundary from token_ledger_events where account_id = $1`,
    [accountId]
  );
  return Number(row.boundary);
}
