import { MAX_PROMPT_BYTES, hashText } from '@prompt-battle/core';
import type { Db } from '../db/pool';
import { TxError, withTransaction } from '../db/pool';
import { appendAudit, digest, enqueue } from './audit';
import { availableTokens, lockAccount, reserveTokens, unresolvedCallCount } from './accounting';
import { loadRules, type Context } from './competitions';
import { assertGenerationOpen, planReservation } from './rules';
import type { ParticipantRow } from './competitions';

export interface AttemptAccepted {
  attemptId: string;
  version: number;
  status: 'queued';
  reservedTokens: number;
  confirmedUsedTokens: number;
  availableTokens: number;
  rulesVersionId: string;
  statusUrl: string;
  replayed: boolean;
}

export interface AdmissionInput {
  context: Context;
  participant: ParticipantRow;
  prompt: string;
  parentAttemptId?: string | null;
  idempotencyKey: string;
  requestId?: string | null;
  inputBoundMode: 'bytes' | 'chars2';
}

/**
 * The admission transaction (architecture s.7).
 *
 * Everything that decides whether a paid remote call may happen is committed
 * atomically here: the immutable attempt, the physical call identity, the token
 * hold, the ledger event and the delivery record. The provider request itself
 * happens later, outside any transaction.
 */
export async function admitAttempt(input: AdmissionInput): Promise<AttemptAccepted> {
  const { context, participant, prompt } = input;
  const promptBytes = Buffer.byteLength(prompt, 'utf8');
  if (promptBytes === 0) throw new TxError('EMPTY_PROMPT', 'A prompt is required', 400);
  if (promptBytes > MAX_PROMPT_BYTES) {
    throw new TxError('PROMPT_TOO_LARGE', `Prompts are limited to ${MAX_PROMPT_BYTES} bytes`, 413);
  }

  const requestDigest = digest({ prompt, parent: input.parentAttemptId ?? null });

  return withTransaction(async (tx) => {
    const competition = await tx.must<Context['competition']>(
      `select * from competitions where id = $1`,
      [context.competition.id]
    );
    const rules = await loadRules(tx, competition.rules_version_id);
    assertGenerationOpen(competition);

    const existing = await tx.one<{ payload_digest: string; response: unknown }>(
      `select payload_digest, response from idempotency_keys
        where participant_id = $1 and competition_id = $2 and operation = 'ADMIT_ATTEMPT' and key = $3`,
      [participant.id, competition.id, input.idempotencyKey]
    );
    if (existing) {
      if (existing.payload_digest !== requestDigest) {
        throw new TxError(
          'IDEMPOTENCY_CONFLICT',
          'This idempotency key was already used with a different prompt',
          409
        );
      }
      return { ...(existing.response as AttemptAccepted), replayed: true };
    }

    const account = await lockAccount(tx, participant.id);
    if (account.account_state !== 'OPEN') {
      throw new TxError('WORKSPACE_SEALED', 'This workspace no longer accepts new generation', 409);
    }

    const state = await tx.must<{ id: string; state: string }>(
      `select id, state from participant_problem_states
        where participant_id = $1 and competition_problem_id = $2`,
      [participant.id, context.problem.competition_problem_id]
    );
    if (state.state !== 'OPEN') {
      throw new TxError('WORKSPACE_SEALED', 'This problem is already finalizing', 409);
    }

    // Initial policy: one unresolved generation per participant.
    if ((await unresolvedCallCount(tx, participant.id)) > 0) {
      throw new TxError(
        'GENERATION_ALREADY_PENDING',
        'Wait for your pending generation to finish before starting another',
        409
      );
    }

    if (input.parentAttemptId) {
      const parent = await tx.one<{ participant_id: string; competition_problem_id: string }>(
        `select participant_id, competition_problem_id from attempts where id = $1`,
        [input.parentAttemptId]
      );
      if (
        !parent ||
        parent.participant_id !== participant.id ||
        parent.competition_problem_id !== context.problem.competition_problem_id
      ) {
        throw new TxError('PARENT_NOT_OWNED', 'The parent attempt does not belong to you', 403);
      }
    }

    const plan = planReservation(rules, prompt, input.inputBoundMode);

    const versionRow = await tx.must<{ next: string }>(
      `select coalesce(max(version_number), 0) + 1 as next
         from attempts where participant_id = $1 and competition_problem_id = $2`,
      [participant.id, context.problem.competition_problem_id]
    );
    const version = Number(versionRow.next);

    const attempt = await tx.must<{ id: string }>(
      `insert into attempts
         (competition_id, participant_id, competition_problem_id, parent_attempt_id, version_number,
          prompt, prompt_hash, prompt_bytes, rules_version_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning id`,
      [
        competition.id,
        participant.id,
        context.problem.competition_problem_id,
        input.parentAttemptId ?? null,
        version,
        prompt,
        hashText(prompt),
        promptBytes,
        rules.id
      ]
    );

    await tx.query(
      `insert into attempt_states (attempt_id, generation_state, accounting_state, practice_state)
       values ($1, 'QUEUED', 'RESERVED', 'NOT_STARTED')`,
      [attempt.id]
    );

    const call = await tx.must<{ id: string }>(
      `insert into provider_calls
         (purpose, payer, attempt_id, participant_id, dispatch_key, request_digest,
          model_id, model_revision, state, reserved_tokens)
       values ('GENERATION', 'PARTICIPANT', $1, $2, $3, $4, $5, $6, 'PENDING', $7)
       returning id`,
      [
        attempt.id,
        participant.id,
        `gen:${attempt.id}`,
        digest(plan.requestDigestInput),
        rules.model_id,
        rules.model_revision,
        plan.reserved
      ]
    );

    await reserveTokens(tx, account, call.id, plan.reserved, `attempt ${attempt.id}`);

    await enqueue(tx, 'GENERATE_ATTEMPT', { callId: call.id, attemptId: attempt.id });

    await appendAudit(tx, {
      actorUserId: null,
      actorKind: 'SYSTEM',
      competitionId: competition.id,
      entityType: 'attempt',
      entityId: attempt.id,
      action: 'ATTEMPT_ADMITTED',
      payload: {
        version,
        reserved: plan.reserved,
        inputBound: plan.inputBound,
        outputCap: plan.outputCap,
        promptHash: hashText(prompt)
      },
      requestId: input.requestId ?? null
    });

    const response: AttemptAccepted = {
      attemptId: attempt.id,
      version,
      status: 'queued',
      reservedTokens: plan.reserved,
      confirmedUsedTokens: Number(account.consumed_tokens),
      availableTokens: availableTokens(account),
      rulesVersionId: rules.id,
      statusUrl: `/v1/attempts/${attempt.id}`,
      replayed: false
    };

    await tx.query(
      `insert into idempotency_keys
         (participant_id, competition_id, operation, key, payload_digest, response)
       values ($1, $2, 'ADMIT_ATTEMPT', $3, $4, $5)`,
      [participant.id, competition.id, input.idempotencyKey, requestDigest, JSON.stringify(response)]
    );

    return response;
  });
}

export interface AttemptSummary {
  id: string;
  version: number;
  parentAttemptId: string | null;
  prompt: string;
  promptHash: string;
  admittedAt: string;
  generationState: string;
  accountingState: string;
  practiceState: string;
  hasAnswer: boolean;
  selected: boolean;
}

export async function listAttempts(
  db: Db,
  participantId: string,
  competitionProblemId: string,
  limit = 50,
  offset = 0
): Promise<AttemptSummary[]> {
  const rows = await db.query<Record<string, unknown>>(
    `select a.id, a.version_number, a.parent_attempt_id, a.prompt, a.prompt_hash, a.admitted_at,
            s.generation_state, s.accounting_state, s.practice_state,
            (b.response_id is not null) as has_answer,
            (fs.id is not null) as selected
       from attempts a
       join attempt_states s on s.attempt_id = a.id
       left join attempt_answer_bindings b on b.attempt_id = a.id
       left join final_selections fs on fs.attempt_id = a.id
      where a.participant_id = $1 and a.competition_problem_id = $2
      order by a.version_number desc
      limit $3 offset $4`,
    [participantId, competitionProblemId, limit, offset]
  );
  return rows.map((r) => ({
    id: r.id as string,
    version: Number(r.version_number),
    parentAttemptId: (r.parent_attempt_id as string) ?? null,
    prompt: r.prompt as string,
    promptHash: r.prompt_hash as string,
    admittedAt: new Date(r.admitted_at as string).toISOString(),
    generationState: r.generation_state as string,
    accountingState: r.accounting_state as string,
    practiceState: r.practice_state as string,
    hasAnswer: r.has_answer as boolean,
    selected: r.selected as boolean
  }));
}

export interface AttemptDetail extends AttemptSummary {
  answer: string | null;
  answerHash: string | null;
  usage: { input: number; output: number; total: number } | null;
  reservedTokens: number | null;
  publicTests: Array<{ key: string; status: string; group: string; weight: number }>;
}

export async function getAttempt(
  db: Db,
  attemptId: string,
  participantId: string
): Promise<AttemptDetail> {
  // Ownership is resolved from the session, never from a client-supplied id.
  const owned = await db.one<{ participant_id: string }>(
    `select participant_id from attempts where id = $1`,
    [attemptId]
  );
  if (!owned || owned.participant_id !== participantId) {
    throw new TxError('NOT_FOUND', 'Attempt not found', 404);
  }

  const row = await db.one<Record<string, unknown>>(
    `select a.id, a.version_number, a.parent_attempt_id, a.prompt, a.prompt_hash, a.admitted_at,
            s.generation_state, s.accounting_state, s.practice_state,
            b.response_id, r.body, r.body_hash,
            u.input_tokens, u.output_tokens, u.total_tokens,
            tr.reserved_upper_bound,
            (fs.id is not null) as selected
       from attempts a
       join attempt_states s on s.attempt_id = a.id
       left join attempt_answer_bindings b on b.attempt_id = a.id
       left join ai_responses r on r.id = b.response_id
       left join provider_usage_receipts u on u.provider_call_id = r.provider_call_id
       left join token_reservations tr on tr.provider_call_id = r.provider_call_id
       left join final_selections fs on fs.attempt_id = a.id
      where a.id = $1`,
    [attemptId]
  );
  if (!row) throw new TxError('NOT_FOUND', 'Attempt not found', 404);

  const tests = await db.query<{ test_key: string; status: string; group_code: string; weight: string }>(
    `select t.test_key, t.status, t.group_code, t.weight
       from test_results t
       join evaluation_runs e on e.id = t.evaluation_run_id
      where e.attempt_id = $1 and e.purpose = 'PUBLIC_PRACTICE' and t.visibility = 'public'
      order by t.test_key`,
    [attemptId]
  );

  return {
    id: row.id as string,
    version: Number(row.version_number),
    parentAttemptId: (row.parent_attempt_id as string) ?? null,
    prompt: row.prompt as string,
    promptHash: row.prompt_hash as string,
    admittedAt: new Date(row.admitted_at as string).toISOString(),
    generationState: row.generation_state as string,
    accountingState: row.accounting_state as string,
    practiceState: row.practice_state as string,
    hasAnswer: row.response_id !== null,
    selected: row.selected as boolean,
    answer: (row.body as string) ?? null,
    answerHash: (row.body_hash as string) ?? null,
    usage:
      row.total_tokens === null || row.total_tokens === undefined
        ? null
        : {
            input: Number(row.input_tokens),
            output: Number(row.output_tokens),
            total: Number(row.total_tokens)
          },
    reservedTokens: row.reserved_upper_bound === null ? null : Number(row.reserved_upper_bound),
    publicTests: tests.map((t) => ({
      key: t.test_key,
      status: t.status,
      group: t.group_code,
      weight: Number(t.weight)
    }))
  };
}
