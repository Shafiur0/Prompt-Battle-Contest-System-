import {earliestCorrectCompletion} from '../solving-time';
import { randomUUID } from 'node:crypto';
import { calculateScore } from '@prompt-battle/core';
import { transaction,audit } from '../db';
import { digest,num,problemForManifest } from '../domain';
export async function finalize(selectionId:string){
 await transaction(async db=>{
  const scope=(await db.query('SELECT competition_id FROM final_selections WHERE id=$1',[selectionId])).rows[0];if(!scope)return;
  await db.query('SELECT id FROM competitions WHERE id=$1 FOR SHARE',[scope.competition_id]);
  const row=(await db.query('SELECT f.*,s.id AS workflow_id,s.effective_decision_id,c.closure_epoch,c.problem,m.manifest FROM final_selections f JOIN submission_states s ON s.selection_id=f.id JOIN competitions c ON c.id=f.competition_id JOIN attempts a ON a.id=f.attempt_id JOIN competition_rules_versions m ON m.id=a.rules_version_id WHERE f.id=$1 FOR UPDATE OF s',[selectionId])).rows[0];if(!row)return;
  const account=(await db.query('SELECT * FROM token_accounts WHERE participant_id=$1 FOR UPDATE',[row.participant_id])).rows[0];
  if(num(account.reserved)>0||account.state==='ACCOUNTING_INCIDENT')return;
  const ledger=(await db.query('SELECT id,kind,consumed_delta,reserved_delta FROM token_ledger_events WHERE participant_id=$1 ORDER BY created_at,id',[row.participant_id])).rows;
  if(ledger.reduce((sum,r)=>sum+num(r.consumed_delta),0)!==num(account.consumed))throw new Error('LEDGER_ACCOUNT_MISMATCH');
  await db.query('INSERT INTO token_snapshots(id,selection_id,consumed,ledger_digest) VALUES($1,$2,$3,$4) ON CONFLICT(selection_id) DO NOTHING',[randomUUID(),selectionId,num(account.consumed),digest(ledger)]);
  const snapshot=(await db.query('SELECT * FROM token_snapshots WHERE selection_id=$1',[selectionId])).rows[0];
  const quality=(await db.query('SELECT * FROM quality_evaluations WHERE selection_id=$1',[selectionId])).rows[0];
  const humanQuality=(await db.query('SELECT * FROM quality_human_reviews WHERE selection_id=$1 ORDER BY created_at DESC LIMIT 1',[selectionId])).rows[0];
  if(!quality||(!humanQuality&&quality.j==null)||!row.closure_epoch||!row.effective_decision_id)return;
  const decision=(await db.query('SELECT * FROM policy_reviews WHERE id=$1 AND selection_id=$2',[row.effective_decision_id,selectionId])).rows[0];
  if(!decision||decision.verdict==='INSUFFICIENT_EVIDENCE')return;
  const evaluation=quality.evaluation;
  // PostgreSQL folds an unquoted J column to j.
  const qualityJ=humanQuality?num(humanQuality.j):num(quality.j);
  if(!Number.isFinite(qualityJ))return;
  const calculated=calculateScore({C:evaluation.C,K:evaluation.K,J:qualityJ,T:num(snapshot.consumed),eligible:evaluation.eligible,reviewedCopyingPenaltyPoints:decision.penalty});
  const score={finalScore:calculated.finalScore,finalScoreExact:calculated.finalScoreExact,quality:calculated.Q,correctness:evaluation.C,critical:evaluation.K,judge:qualityJ,efficiency:calculated.E,tokenUsage:num(snapshot.consumed),eligible:evaluation.eligible};
  let timing:any=null;
  if(row.manifest.rankingMode==='EARLIEST_CORRECT_TIEBREAK_V1'){
   const problem=await problemForManifest(row.competition_id,row.manifest,row.problem,db);
   const attempts=(await db.query("SELECT a.id,m.manifest->>'problemVersionId' AS version,r.answer,r.created_at FROM attempts a JOIN responses r ON r.attempt_id=a.id JOIN competition_rules_versions m ON m.id=a.rules_version_id WHERE a.participant_id=$1 AND a.competition_id=$2",[row.participant_id,row.competition_id])).rows.map(a=>({id:a.id,problemVersionId:a.version,answer:a.answer,receivedAt:a.created_at}));
   const calculatedTiming=earliestCorrectCompletion(attempts,problem.versionId,row.manifest.competitionStartedAt,problem,evaluation.eligible);
   await db.query('INSERT INTO solving_timings(selection_id,first_correct_attempt_id,first_correct_at,elapsed_ms,problem_version_id,evidence_digest) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(selection_id) DO NOTHING',[selectionId,calculatedTiming.firstCorrectAttemptId,calculatedTiming.firstCorrectAt,calculatedTiming.elapsedMs,problem.versionId,digest({versionId:problem.versionId,startedAt:row.manifest.competitionStartedAt,...calculatedTiming})]);
   timing=(await db.query('SELECT * FROM solving_timings WHERE selection_id=$1',[selectionId])).rows[0];
  }
  Object.assign(score,{copyingPenalty:decision.penalty,penaltySource:decision.mode==='AUTOMATIC_REVIEWER'?'AI_REVIEWER':'HUMAN',problemRevision:row.manifest.problemRevision||null,problemVersionId:row.manifest.problemVersionId||null,...(timing?{solveElapsedMs:timing.elapsed_ms==null?null:num(timing.elapsed_ms),firstCorrectAt:timing.first_correct_at?.toISOString()||null}:{})});
  const inputDigest=digest({selectionId,snapshotId:snapshot.id,qualityId:quality.id,humanQualityId:humanQuality?.id||null,decisionId:decision.id,formulaVersion:calculated.formulaVersion});
  const id=randomUUID();
  await db.query('INSERT INTO score_revisions(id,selection_id,decision_id,token_snapshot_id,score,input_digest) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(input_digest) DO NOTHING',[id,selectionId,decision.id,snapshot.id,JSON.stringify(score),inputDigest]);
  const revision=(await db.query('SELECT id FROM score_revisions WHERE input_digest=$1',[inputDigest])).rows[0];
  await db.query('UPDATE submission_states SET status=\'FINALIZED\',published_score_id=$2,updated_at=clock_timestamp() WHERE id=$1',[row.workflow_id,revision.id]);
  await db.query('UPDATE participants SET workspace_state=\'FINALIZED\' WHERE id=$1',[row.participant_id]);
  await db.query('UPDATE token_accounts SET state=\'FINALIZED\' WHERE participant_id=$1',[row.participant_id]);
  await audit(db,row.competition_id,null,'SCORE_REVISION_READY',{selectionId,scoreRevisionId:revision.id,inputDigest});
 });
}
