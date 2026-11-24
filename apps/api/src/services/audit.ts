import { createHash } from 'node:crypto';
import type { Db } from '../db/pool';

export function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export interface AuditInput {
  actorUserId: string | null;
  actorKind?: 'USER' | 'SYSTEM' | 'WORKER';
  competitionId?: string | null;
  entityType: string;
  entityId: string;
  action: string;
  payload?: unknown;
  requestId?: string | null;
}

/**
 * Append-only, hash-linked audit trail. A constant advisory lock keeps the
 * chain linear under concurrent writers.
 */
export async function appendAudit(tx: Db, input: AuditInput): Promise<void> {
  await tx.query(`select pg_advisory_xact_lock(721404)`);
  const previous = await tx.one<{ hash: string }>(
    `select hash from audit_events order by id desc limit 1`
  );
  const prevHash = previous?.hash ?? null;
  const body = {
    actorUserId: input.actorUserId,
    actorKind: input.actorKind ?? 'USER',
    competitionId: input.competitionId ?? null,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    payload: input.payload ?? {}
  };
  const hash = createHash('sha256').update(`${prevHash ?? 'genesis'}|${JSON.stringify(body)}`).digest('hex');
  await tx.query(
    `insert into audit_events
       (actor_user_id, actor_kind, competition_id, entity_type, entity_id, action, payload, request_id, prev_hash, hash)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      input.actorUserId,
      body.actorKind,
      body.competitionId,
      body.entityType,
      body.entityId,
      body.action,
      JSON.stringify(body.payload),
      input.requestId ?? null,
      prevHash,
      hash
    ]
  );
}

export async function enqueue(
  tx: Db,
  topic: string,
  payload: Record<string, unknown>,
  delayMs = 0
): Promise<void> {
  await tx.query(
    `insert into outbox_events (topic, payload, available_at)
     values ($1, $2, now() + ($3 || ' milliseconds')::interval)`,
    [topic, JSON.stringify(payload), String(delayMs)]
  );
}
