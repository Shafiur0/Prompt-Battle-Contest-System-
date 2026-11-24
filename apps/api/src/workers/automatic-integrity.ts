import {randomUUID} from 'node:crypto';
import {detectProtectedCopy,buildAutomaticReviewerRequest,buildAutomaticIntegrityDecision,assertIntegrityReviewAllowed,stableUuid,type ReviewServerContext} from '@prompt-battle/core';
import {pool,transaction,audit,enqueue} from '../db';
import {digest} from '../domain';
import {selected,run,invoke} from './evaluation-support';
export async function evaluateAutomaticIntegrity(selectionId:string,epoch:string,appealId?:string){
 const row=await selected(selectionId);if(row.manifest.reviewMode!=='AUTOMATIC_REVIEWER'||row.closure_epoch!==epoch)throw new Error('Automatic review mode/closure mismatch');
 const proof=(await pool.query('SELECT proof FROM closure_proofs WHERE epoch=$1 AND competition_id=$2',[epoch,row.competition_id])).rows[0]?.proof;assertIntegrityReviewAllowed(proof);
 const appeal=appealId?(await pool.query('SELECT * FROM appeals WHERE id=$1 AND selection_id=$2 AND status=\'OPEN\'',[appealId,selectionId])).rows[0]:null;
 if(appealId&&!appeal)return;
 if((await pool.query('SELECT id FROM integrity_reports WHERE selection_id=$1 AND '+(appealId?'appeal_id=$2':'review_revision=1'),appealId?[selectionId,appealId]:[selectionId])).rowCount)return;
 let det=(await pool.query('SELECT * FROM integrity_detections WHERE selection_id=$1',[selectionId])).rows[0];
 if(!det){const detection=detectProtectedCopy(row.prompt,row.problem.registry),matchRun=await run(row,'CRITICAL_MATCH',{promptHash:digest(row.prompt),registryVersionId:row.problem.registry.versionId});if(!matchRun)return;
  await transaction(async db=>{await db.query('INSERT INTO integrity_detections(selection_id,run_id,detection) VALUES($1,$2,$3) ON CONFLICT(selection_id) DO NOTHING',[selectionId,matchRun,JSON.stringify(detection)]);await db.query('UPDATE evaluation_runs SET status=\'COMPLETE\' WHERE id=$1',[matchRun]);await audit(db,row.competition_id,null,'POST_CLOSURE_DETECTION_RECORDED',{selectionId,matchRun,closureEpoch:epoch});});det=(await pool.query('SELECT * FROM integrity_detections WHERE selection_id=$1',[selectionId])).rows[0];}
 const context:ReviewServerContext={competitionId:row.competition_id,participantId:row.participant_id,selectedAttemptId:row.attempt_id,reviewerModelVersionId:row.manifest.reviewerModelVersionId||stableUuid(row.manifest.reviewerModel+':automatic-v3'),closure:proof,prompt:row.prompt,problem:row.problem,detection:det.detection};
 const request=buildAutomaticReviewerRequest(context,appeal?{reason:appeal.reason}:undefined),purpose=appealId?'CRITICAL_APPEAL_REVIEW:'+appealId:'CRITICAL_CONTEXT_REVIEW';
 const runId=await run(row,purpose,request,det.run_id);if(!runId)return;
 try{
  let decision:ReturnType<typeof buildAutomaticIntegrityDecision>|null=null,rawOutput:any=null;
  for(let attempt=0;attempt<3;attempt++){const raw=await invoke(runId,row,'REVIEWER',request);try{decision=buildAutomaticIntegrityDecision(context,raw);rawOutput=JSON.parse(raw);break;}catch(error){if(attempt===2)throw error;}}
  if(!decision)throw new Error('Automatic review remained invalid');const resolved=decision;
  await transaction(async db=>{
   const state=(await db.query('SELECT * FROM submission_states WHERE selection_id=$1 FOR UPDATE',[selectionId])).rows[0];
   const revision=Number((await db.query('SELECT COALESCE(max(review_revision),0)+1 AS n FROM integrity_reports WHERE selection_id=$1',[selectionId])).rows[0].n),reportId=randomUUID(),decisionId=randomUUID();
   await db.query('INSERT INTO integrity_reports(id,selection_id,run_id,raw_output,report,review_revision,appeal_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[reportId,selectionId,runId,JSON.stringify(rawOutput),JSON.stringify(resolved.report),revision,appealId||null]);
   const verdict=resolved.verdict==='COPY_VIOLATION'?'CONFIRMED_VIOLATION':resolved.verdict;
   await db.query('INSERT INTO policy_reviews(id,selection_id,actor_id,report_id,mode,verdict,rule_id,severity,reason,penalty,predecessor_id,rule_ids,evidence_ids) VALUES($1,$2,NULL,$3,\'AUTOMATIC_REVIEWER\',$4,$5,$6,$7,$8,$9,$10,$11)',[decisionId,selectionId,reportId,verdict,resolved.ruleIds[0]||null,resolved.severity,resolved.reason||'Automatic contextual review completed.',resolved.penalty,state.effective_decision_id||null,JSON.stringify(resolved.ruleIds),JSON.stringify(resolved.evidenceIds)]);
   await db.query('UPDATE evaluation_runs SET status=\'COMPLETE\' WHERE id=$1',[runId]);await db.query('UPDATE submission_states SET status=\'PROCESSING\',effective_decision_id=$2,updated_at=clock_timestamp() WHERE selection_id=$1',[selectionId,decisionId]);
   if(appealId&&!resolved.pending)await db.query('UPDATE appeals SET status=\'RESOLVED\',resolution_id=$2 WHERE id=$1',[appealId,decisionId]);
   await enqueue(db,'FINALIZE',selectionId+':automatic-decision:'+decisionId,{selectionId});await audit(db,row.competition_id,null,'AUTOMATIC_INTEGRITY_DECISION',{selectionId,reportId,decisionId,verdict,penalty:resolved.penalty,ruleIds:resolved.ruleIds,evidenceIds:resolved.evidenceIds,appealId:appealId||null,problemVersionId:row.problem.versionId});
  });
 }catch(error){const failure=error instanceof Error?error.message:'Automatic reviewer unavailable';await pool.query('UPDATE evaluation_runs SET status=\'FAILED\',failure_reason=$2 WHERE id=$1',[runId,failure]);await transaction(async db=>{await audit(db,row.competition_id,null,'AUTOMATIC_REVIEW_PENDING',{selectionId,runId,failureCode:failure,appealId:appealId||null});});}
}