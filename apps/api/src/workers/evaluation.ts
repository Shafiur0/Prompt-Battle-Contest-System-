import {selected,run,invoke} from './evaluation-support';
import {evaluateAutomaticIntegrity} from './automatic-integrity';
import { randomUUID } from 'node:crypto';
import { evaluateAnswer,aggregateQualityJudgments,validateQualityJudgeOutput,buildQualityJudgeRequest,detectProtectedCopy,buildCanonicalReviewReport,buildCriticalReviewerRequest,assertIntegrityReviewAllowed,stableUuid,type CompetitionProblem,type ReviewServerContext } from '@prompt-battle/core';
import { OpenRouterError,type CompleteInput } from '@prompt-battle/openrouter';
import { pool,transaction,audit,enqueue } from '../db';
import { config } from '../config';
import { digest,registryFor,competitionRow } from '../domain';
import { router,receipt,validUsage } from './generation';
import { archiveCallEvidence,claimEvaluation } from './evidence';
export async function evaluateQuality(selectionId:string){
 if((await pool.query('SELECT id FROM quality_evaluations WHERE selection_id=$1',[selectionId])).rowCount)return;
 const prior=(await pool.query('SELECT * FROM evaluation_runs WHERE selection_id=$1 AND purpose=\'QUALITY\' AND status=\'RUNNING\' ORDER BY created_at DESC LIMIT 1',[selectionId])).rows[0];
 if(prior){ if(new Date(prior.heartbeat_at||prior.created_at).getTime()>Date.now()-300000)return;
  const original=await selected(selectionId),evaluation=evaluateAnswer(original.answer,original.problem);
  await transaction(async db=>{
   await db.query('UPDATE evaluation_runs SET status=\'FAILED\',failure_reason=\'INTERRUPTED_QUALITY_REVIEW\' WHERE id=$1',[prior.id]);
   await db.query('INSERT INTO quality_evaluations(selection_id,evaluation,judgments,J,needs_human_review) VALUES($1,$2,\'[]\',NULL,true) ON CONFLICT(selection_id) DO NOTHING',[selectionId,JSON.stringify(evaluation)]);
   await enqueue(db,'FINALIZE',selectionId+':quality-interrupted',{selectionId});
   await audit(db,original.competition_id,null,'QUALITY_HUMAN_FALLBACK_REQUIRED',{selectionId,runId:prior.id,reason:'Unknown prior model dispatch; no blind retry'});
  });
  return;
 }
 const row=await selected(selectionId),evaluation=evaluateAnswer(row.answer,row.problem),request=buildQualityJudgeRequest(row.answer,evaluation,row.problem),runId=await run(row,'QUALITY',request);
 if(!runId)return;
 const judgments:any[]=[];let J:number|null=null,needsHuman=true,failure:string|null=null;
 try{
  for(let pass=0;pass<2;pass++){
   let valid:any=null;
   for(let repair=0;repair<3;repair++){
    const raw=await invoke(runId,row,'QUALITY',request);
    try{valid=validateQualityJudgeOutput(raw,row.answer);break;}catch{if(repair===2)throw new Error('INVALID_QUALITY_SCHEMA_OR_EVIDENCE');}
   }
   judgments.push(valid);
  }
  const aggregate=aggregateQualityJudgments(judgments,row.answer);J=aggregate.J;needsHuman=aggregate.needsHumanReview;
  if(needsHuman&&row.manifest.reviewMode==='AUTOMATIC_REVIEWER'){J=judgments.reduce((sum:number,j:any)=>sum+(2*j.scores.clarity+2*j.scores.justification+j.scores.conciseness)/20,0)/judgments.length;needsHuman=false;}
  if(needsHuman)failure='QUALITY_JUDGE_DISAGREEMENT';
 }catch(error){failure=error instanceof Error?error.message:'QUALITY_REVIEW_UNAVAILABLE';}
 await transaction(async db=>{
  await db.query('INSERT INTO quality_evaluations(selection_id,evaluation,judgments,J,needs_human_review) VALUES($1,$2,$3,$4,$5) ON CONFLICT(selection_id) DO NOTHING',[selectionId,JSON.stringify(evaluation),JSON.stringify(judgments),J,needsHuman]);
  await db.query('UPDATE evaluation_runs SET status=$2,failure_reason=$3 WHERE id=$1',[runId,needsHuman?'FAILED':'COMPLETE',failure]);
  await enqueue(db,'FINALIZE',selectionId+':quality',{selectionId});
  await audit(db,row.competition_id,null,'SOLUTION_QUALITY_EVALUATED',{selectionId,runId,needsHumanReview:needsHuman,failureCode:failure});
 });
}
export async function evaluateIntegrity(selectionId:string,epoch:string){
 const row=await selected(selectionId);
 if(row.manifest.reviewMode==='AUTOMATIC_REVIEWER')return evaluateAutomaticIntegrity(selectionId,epoch);
 if(row.closure_epoch!==epoch)throw new Error('CLOSURE_PROOF_MISMATCH');
 const proof=(await pool.query('SELECT proof FROM closure_proofs WHERE epoch=$1 AND competition_id=$2',[epoch,row.competition_id])).rows[0]?.proof;
 assertIntegrityReviewAllowed(proof);
 let detectionRow=(await pool.query('SELECT * FROM integrity_detections WHERE selection_id=$1',[selectionId])).rows[0];
 if(!detectionRow){
  const detection=detectProtectedCopy(row.prompt,row.problem.registry);
  const matchingRun=await run(row,'CRITICAL_MATCH',{promptHash:digest(row.prompt),registryVersionId:row.problem.registry.versionId,normalizerVersion:detection.normalizerVersion});if(!matchingRun)return;
  await transaction(async db=>{
   await db.query('INSERT INTO integrity_detections(selection_id,run_id,detection) VALUES($1,$2,$3) ON CONFLICT(selection_id) DO NOTHING',[selectionId,matchingRun,JSON.stringify(detection)]);
   await db.query('UPDATE evaluation_runs SET status=\'COMPLETE\' WHERE id=$1',[matchingRun]);
   await audit(db,row.competition_id,null,'POST_CLOSURE_DETECTION_RECORDED',{selectionId,matchingRun,closureEpoch:epoch});
  });
  detectionRow=(await pool.query('SELECT * FROM integrity_detections WHERE selection_id=$1',[selectionId])).rows[0];
 }
 if((await pool.query('SELECT id FROM integrity_reports WHERE selection_id=$1',[selectionId])).rowCount)return;
 const context:ReviewServerContext={competitionId:row.competition_id,participantId:row.participant_id,selectedAttemptId:row.attempt_id,reviewerModelVersionId:row.manifest.reviewerModelVersionId||stableUuid(row.manifest.reviewerModel+':critical-review-prepared-v1'),closure:proof,prompt:row.prompt,problem:row.problem as CompetitionProblem,detection:detectionRow.detection};
 const priorContext=(await pool.query('SELECT id,heartbeat_at,created_at FROM evaluation_runs WHERE selection_id=$1 AND purpose=\'CRITICAL_CONTEXT_REVIEW\' AND status=\'RUNNING\' ORDER BY created_at DESC LIMIT 1',[selectionId])).rows[0];
 if(priorContext){if(new Date(priorContext.heartbeat_at||priorContext.created_at).getTime()>Date.now()-300000)return;
  await pool.query('UPDATE evaluation_runs SET status=\'FAILED\',failure_reason=\'INTERRUPTED_CONTEXT_REVIEW_NO_BLIND_RETRY\' WHERE id=$1',[priorContext.id]);
  await transaction(async db=>{await audit(db,row.competition_id,null,'HUMAN_ONLY_REVIEW_FALLBACK_AVAILABLE',{selectionId,runId:priorContext.id,failureCode:'UNKNOWN_PRIOR_CONTEXT_DISPATCH'});});
  return;
 }
 const request=buildCriticalReviewerRequest(context,row.manifest.reviewPackage!=='critical-review-instruction-package-v1'),runId=await run(row,'CRITICAL_CONTEXT_REVIEW',request,detectionRow.run_id);if(!runId)return;
 try{
  let canonical:any=null,rawOutput:any=null;
  for(let attempt=0;attempt<3;attempt++){
   const raw=await invoke(runId,row,'REVIEWER',request);
   try{canonical=buildCanonicalReviewReport(context,raw);rawOutput=JSON.parse(raw);break;}catch{if(attempt===2)throw new Error('INVALID_REVIEWER_SCHEMA_OR_EVIDENCE');}
  }
  await transaction(async db=>{
   await db.query('INSERT INTO integrity_reports(selection_id,run_id,raw_output,report) VALUES($1,$2,$3,$4) ON CONFLICT(selection_id,review_revision) DO NOTHING',[selectionId,runId,JSON.stringify(rawOutput),JSON.stringify(canonical)]);
   await db.query('UPDATE evaluation_runs SET status=\'COMPLETE\' WHERE id=$1',[runId]);
   await db.query('UPDATE submission_states SET status=\'PROCESSING\' WHERE selection_id=$1',[selectionId]);
   await audit(db,row.competition_id,null,'PRIVATE_CONTEXTUAL_REVIEW_RECORDED',{selectionId,runId,humanConfirmationRequired:true});
  });
 }catch(error){
  const failure=error instanceof Error?error.message:'CONTEXTUAL_REVIEW_UNAVAILABLE';
  await pool.query('UPDATE evaluation_runs SET status=\'FAILED\',failure_reason=$2 WHERE id=$1',[runId,failure]);
  await transaction(async db=>{await audit(db,row.competition_id,null,'HUMAN_ONLY_REVIEW_FALLBACK_AVAILABLE',{selectionId,runId,failureCode:failure});});
 }
}
