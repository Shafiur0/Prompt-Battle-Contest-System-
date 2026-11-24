import { createHash } from 'node:crypto';
import {
  SAMPLE_PROBLEM,
  evaluateAllocationAnswer,
  type AllocationData,
  type CompetitionProblem
} from '@prompt-battle/core';
import type { Db } from '../db/pool';
import { TxError, withTransaction } from '../db/pool';
import { appendAudit, enqueue } from './audit';
import type { ProblemRow } from './rules';

export function problemFromRow(row: ProblemRow): CompetitionProblem {
  const payload = row.problem_payload as {
    data?: AllocationData;
    publicRules?: CompetitionProblem['publicRules'];
  };
  if (!payload?.data) {
    throw new TxError('PROBLEM_INVALID', 'Problem payload has no allocation data', 500);
  }
  return {
    ...SAMPLE_PROBLEM,
    id: row.problem_id,
    versionId: row.problem_version_id,
    title: row.title,
    statement: row.statement,
    data: payload.data,
    publicRules: payload.publicRules ?? SAMPLE_PROBLEM.publicRules
  };
}

function digestInput(...parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

/**
 * Public practice evaluation. Deterministic tests only; no hidden material is
 * touched and no judge is called. Results are visible to the owner immediately.
 */
export async function runPracticeEvaluation(attemptId: string): Promise<void> {
  await withTransaction(async (tx) => {
    const attempt = await tx.one<{
      id: string;
      competition_id: string;
      body: string;
      body_hash: string;
      competition_problem_id: string;
    }>(
      `select a.id, a.competition_id, a.competition_problem_id, r.body, r.body_hash
         from attempts a
         join attempt_answer_bindings b on b.attempt_id = a.id
         join ai_responses r on r.id = b.response_id
        where a.id = $1`,
      [attemptId]
    );
    if (!attempt) return; // no canonical answer yet

    const existing = await tx.one<{ id: string }>(
      `select id from evaluation_runs where attempt_id = $1 and purpose = 'PUBLIC_PRACTICE'`,
      [attemptId]
    );
    if (existing) return;

    const problem = await loadProblemRow(tx, attempt.competition_problem_id);
    const evaluation = evaluateAllocationAnswer(attempt.body, problemFromRow(problem));

    const run = await tx.must<{ id: string }>(
      `insert into evaluation_runs
         (purpose, competition_id, attempt_id, input_digest, state)
       values ('PUBLIC_PRACTICE', $1, $2, $3, 'RUNNING')
       returning id`,
      [attempt.competition_id, attemptId, digestInput(attempt.body_hash, problem.problem_version_id)]
    );

    for (const test of evaluation.publicTests) {
      await tx.query(
        `insert into test_results
           (evaluation_run_id, test_key, visibility, status, weight, group_code, evidence)
         values ($1, $2, 'public', $3, $4, $5, $6)`,
        [
          run.id,
          test.id,
          test.passed ? 'PASS' : 'FAIL',
          test.weight,
          test.group,
          JSON.stringify({ name: test.name, detail: test.detail })
        ]
      );
    }

    await tx.query(`update evaluation_runs set state = 'COMPLETE' where id = $1`, [run.id]);
    await tx.query(
      `update attempt_states set practice_state = 'COMPLETE', updated_at = now() where attempt_id = $1`,
      [attemptId]
    );
  });
}

export interface FinalEvaluationSummary {
  C: number;
  K: number;
  eligible: boolean;
  computedCost: number | null;
  runId: string;
  summary: string;
}

/**
 * Final solution evaluation on the exact sealed answer. Never regenerates.
 */
export async function runFinalEvaluation(finalSelectionId: string): Promise<FinalEvaluationSummary> {
  return withTransaction(async (tx) => {
    const selection = await tx.must<{
      competition_id: string;
      attempt_id: string;
      competition_problem_id: string;
      body: string;
      body_hash: string;
    }>(
      `select fs.competition_id, fs.attempt_id, fs.competition_problem_id, r.body, r.body_hash
         from final_selections fs
         join attempt_answer_bindings b on b.attempt_id = fs.attempt_id
         join ai_responses r on r.id = b.response_id
        where fs.id = $1`,
      [finalSelectionId]
    );

    const existing = await tx.one<{ id: string; state: string }>(
      `select id, state from evaluation_runs where final_selection_id = $1 and purpose = 'FINAL_SOLUTION'`,
      [finalSelectionId]
    );

    const problem = await loadProblemRow(tx, selection.competition_problem_id);
    const evaluation = evaluateAllocationAnswer(selection.body, problemFromRow(problem));

    let runId = existing?.id;
    if (!runId) {
      const run = await tx.must<{ id: string }>(
        `insert into evaluation_runs
           (purpose, competition_id, attempt_id, final_selection_id, input_digest, state)
         values ('FINAL_SOLUTION', $1, $2, $3, $4, 'RUNNING')
         returning id`,
        [
          selection.competition_id,
          selection.attempt_id,
          finalSelectionId,
          digestInput(selection.body_hash, problem.problem_version_id, 'final')
        ]
      );
      runId = run.id;

      for (const test of evaluation.finalTests) {
        await tx.query(
          `insert into test_results
             (evaluation_run_id, test_key, visibility, status, weight, group_code, evidence)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [
            runId,
            test.id,
            test.visibility,
            test.passed ? 'PASS' : 'FAIL',
            test.weight,
            test.group,
            JSON.stringify({ name: test.name, detail: test.detail })
          ]
        );
      }
      await tx.query(`update evaluation_runs set state = 'COMPLETE' where id = $1`, [runId]);
    }

    return {
      C: evaluation.C,
      K: evaluation.K,
      eligible: evaluation.eligible,
      computedCost: evaluation.computedCost,
      runId,
      summary: evaluation.summary
    };
  });
}

export async function loadProblemRow(tx: Db, competitionProblemId: string): Promise<ProblemRow> {
  const row = await tx.one<ProblemRow>(
    `select cp.id as competition_problem_id, pv.id as problem_version_id, p.id as problem_id,
            p.problem_type, pv.title, pv.statement, pv.objectives, pv.public_constraints,
            pv.output_contract, pv.public_examples, pv.problem_payload
       from competition_problems cp
       join problem_versions pv on pv.id = cp.problem_version_id
       join problems p on p.id = pv.problem_id
      where cp.id = $1`,
    [competitionProblemId]
  );
  if (!row) throw new TxError('PROBLEM_NOT_FOUND', 'Problem not found', 404);
  return row;
}

export { enqueue };
