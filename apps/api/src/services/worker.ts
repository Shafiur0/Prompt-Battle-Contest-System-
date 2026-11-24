import { hashText } from '@prompt-battle/core';
import { config } from '../config';
import { db, withTransaction } from '../db/pool';
import { settleCall, releaseCall } from './accounting';
import { appendAudit, enqueue } from './audit';
import { runPracticeEvaluation } from './evaluation';
import { ProviderAmbiguous, ProviderRejected, generate } from './provider';
import { loadRules } from './competitions';
import { buildEnvelope } from './rules';

interface OutboxRow {
  id: string;
  topic: string;
  payload: Record<string, string>;
  attempts: number;
}

async function claim(): Promise<OutboxRow | null> {
  const rows = await db.query<OutboxRow>(
    `update outbox_events
        set state = 'DISPATCHED', attempts = attempts + 1
      where id = (
        select id from outbox_events
         where state = 'PENDING' and available_at <= now()
         order by available_at
         limit 1
         for update skip locked
      )
      returning id, topic, payload, attempts`
  );
  return rows[0] ?? null;
}

async function finish(id: string, error?: unknown): Promise<void> {
  if (!error) {
    await db.query(`update outbox_events set state = 'DONE' where id = $1`, [id]);
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  const rows = await db.query<{ attempts: number }>(`select attempts from outbox_events where id = $1`, [id]);
  const attempts = rows[0]?.attempts ?? 1;
  if (attempts >= 5) {
    await db.query(`update outbox_events set state = 'FAILED', last_error = $2 where id = $1`, [id, message.slice(0, 500)]);
    return;
  }
  await db.query(
    `update outbox_events
        set state = 'PENDING',
            last_error = $2,
            available_at = now() + ($3 || ' milliseconds')::interval
      where id = $1`,
    [id, message.slice(0, 500), String(500 * 2 ** attempts)]
  );
}

/**
 * Dispatches one admitted generation call.
 *
 * The dispatch intent is committed before the remote request and the answer is
 * committed after it, so a crash leaves a recoverable hold rather than a
 * silently unbilled attempt.
 */
async function dispatchGeneration(callId: string, attemptId: string): Promise<void> {
  const call = await db.one<{
    id: string;
    state: string;
    attempt_id: string;
    reserved_tokens: string;
  }>(`select id, state, attempt_id, reserved_tokens from provider_calls where id = $1`, [callId]);

  if (!call || call.state !== 'PENDING') return; // already handled

  const attempt = await db.must<{ prompt: string; rules_version_id: string; competition_id: string }>(
    `select prompt, rules_version_id, competition_id from attempts where id = $1`,
    [attemptId]
  );
  const rules = await loadRules(db, attempt.rules_version_id);
  const envelope = buildEnvelope(rules, attempt.prompt);

  await withTransaction(async (tx) => {
    await tx.query(
      `update provider_calls set state = 'DISPATCH_INTENT', dispatched_at = now() where id = $1 and state = 'PENDING'`,
      [callId]
    );
    await tx.query(
      `update attempt_states set generation_state = 'DISPATCH_INTENT', updated_at = now() where attempt_id = $1`,
      [attemptId]
    );
  });

  let result;
  try {
    result = await generate(envelope, rules.max_output_tokens);
  } catch (error) {
    await withTransaction(async (tx) => {
      if (error instanceof ProviderRejected) {
        // Confirmed unprocessed: the hold may be released.
        await releaseCall(tx, callId, `provider rejected: ${error.message.slice(0, 200)}`);
        await tx.query(
          `update attempt_states set generation_state = 'REJECTED_UNBILLED', accounting_state = 'RELEASED',
                  updated_at = now() where attempt_id = $1`,
          [attemptId]
        );
      } else {
        // Unknown outcome: keep the hold, never invent a zero.
        await tx.query(
          `update provider_calls set state = 'FAILED_USAGE_PENDING' where id = $1`,
          [callId]
        );
        await tx.query(
          `update attempt_states set generation_state = 'FAILED_USAGE_PENDING', accounting_state = 'USAGE_PENDING',
                  updated_at = now() where attempt_id = $1`,
          [attemptId]
        );
      }
      await appendAudit(tx, {
        actorUserId: null,
        actorKind: 'WORKER',
        competitionId: attempt.competition_id,
        entityType: 'provider_call',
        entityId: callId,
        action: error instanceof ProviderRejected ? 'GENERATION_REJECTED' : 'GENERATION_AMBIGUOUS',
        payload: { message: error instanceof Error ? error.message.slice(0, 300) : 'unknown' }
      });
    });
    if (error instanceof ProviderRejected) return; // terminal, do not retry
    if (error instanceof ProviderAmbiguous) return; // hold retained for reconciliation
    throw error;
  }

  await withTransaction(async (tx) => {
    const response = await tx.must<{ id: string }>(
      `insert into ai_responses (provider_call_id, attempt_id, body, body_hash, finish_reason, output_format)
       values ($1, $2, $3, $4, $5, $6)
       returning id`,
      [callId, attemptId, result.body, hashText(result.body), 'stop', 'text']
    );

    await tx.query(
      `insert into attempt_answer_bindings (attempt_id, response_id) values ($1, $2)`,
      [attemptId, response.id]
    );

    const settlement = await settleCall(tx, callId, {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cachedInputTokens: result.cachedInputTokens,
      reasoningTokens: result.reasoningTokens,
      providerRequestId: result.providerRequestId,
      rawUsage: result.rawUsage
    });

    await tx.query(
      `update attempt_states set generation_state = 'GENERATION_COMPLETE', updated_at = now() where attempt_id = $1`,
      [attemptId]
    );

    await appendAudit(tx, {
      actorUserId: null,
      actorKind: 'WORKER',
      competitionId: attempt.competition_id,
      entityType: 'attempt',
      entityId: attemptId,
      action: 'GENERATION_COMPLETE',
      payload: {
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        mode: result.mode,
        modelRevision: result.modelRevision,
        incident: settlement.incident
      }
    });

    await enqueue(tx, 'PRACTICE_EVALUATION', { attemptId });
  });
}

export async function processOnce(): Promise<boolean> {
  const job = await claim();
  if (!job) return false;
  try {
    switch (job.topic) {
      case 'GENERATE_ATTEMPT':
        await dispatchGeneration(job.payload.callId, job.payload.attemptId);
        break;
      case 'PRACTICE_EVALUATION':
        await runPracticeEvaluation(job.payload.attemptId);
        break;
      default:
        break;
    }
    await finish(job.id);
  } catch (error) {
    await finish(job.id, error);
  }
  return true;
}

let running = false;
let timer: NodeJS.Timeout | null = null;

export function startWorker(): void {
  if (!config.worker.enabled || running) return;
  running = true;
  const tick = async (): Promise<void> => {
    try {
      for (let i = 0; i < config.worker.batchSize; i += 1) {
        const processed = await processOnce();
        if (!processed) break;
      }
    } catch (error) {
      console.error('[worker] tick failed', error);
    } finally {
      timer = setTimeout(tick, config.worker.pollIntervalMs);
    }
  };
  void tick();
  console.log('[worker] outbox worker started');
}

export function stopWorker(): void {
  running = false;
  if (timer) clearTimeout(timer);
  timer = null;
}
