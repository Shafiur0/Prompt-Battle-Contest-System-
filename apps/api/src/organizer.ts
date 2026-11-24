import { Injectable } from '@nestjs/common';
import {competitionRanking} from './ranking';
import {currentScoreAvailable} from './invariants';
import { randomUUID } from 'node:crypto';
import { validateRegistry,validateHumanIntegrityDecision,validateStructuredProblemDraft,stableUuid,type CriticalRegistry,type RegistryItem } from '@prompt-battle/core';
import type { AppUser } from './auth';
import { pool,transaction,audit,enqueue } from './db';
import { competitionRow,competitionView,registryFor,digest,requestDigest,num,cancelQueued,replay,remember } from './domain';
import { config,modelReadiness,manifestQualified,approvalFor,REVIEW_PACKAGE,REVIEW_PACKAGE_DIGEST,GENERATION_ENVELOPE } from './config';
import { fail } from './guards';
import { assertOrganizerScope,createCompetition } from './create-competition';
@Injectable()
export class OrganizerService {
 async create(u:AppUser,title:string){return createCompetition(u,title);}
 async dashboard(id:string,u:AppUser){
  const c=await competitionRow(id);assertOrganizerScope(c,u);const registry=await registryFor(c);
  const people=(await pool.query('SELECT p.id,u.alias,p.workspace_state,p.moderation_status,p.public_moderation_notice,t.consumed,t.reserved,s.id AS submission_id FROM participants p JOIN users u ON u.id=p.user_id JOIN token_accounts t ON t.participant_id=p.id LEFT JOIN final_selections f ON f.participant_id=p.id LEFT JOIN submission_states s ON s.selection_id=f.id WHERE p.competition_id=$1 ORDER BY p.created_at',[id])).rows;
  let cases:any[]=[];
  if(c.closure_epoch){
   const rows=(await pool.query('SELECT f.id AS selection_id,s.id AS submission_id,a.id AS attempt_id,a.prompt,r.answer,u.alias,s.status,s.effective_decision_id,sc.decision_id AS score_decision_id,rm.manifest AS selected_manifest,rv.registry AS selected_registry,pv.content AS selected_problem,sc.score,st.elapsed_ms AS solve_elapsed_ms,ir.report,ctx.failure_reason AS context_failure,d.verdict,d.reason,d.penalty,d.mode AS decision_mode,d.rule_ids,det.detection,q.evaluation AS solution_evaluation,q.j AS quality_j,q.needs_human_review,h.j AS human_quality_j,ap.id AS appeal_id,ap.reason AS appeal_reason,ap.status AS appeal_status FROM final_selections f JOIN submission_states s ON s.selection_id=f.id JOIN attempts a ON a.id=f.attempt_id JOIN responses r ON r.id=f.response_id JOIN competition_rules_versions rm ON rm.id=a.rules_version_id LEFT JOIN registry_versions rv ON rv.id=(rm.manifest->>\'registryVersionId\')::uuid AND rv.competition_id=f.competition_id LEFT JOIN problem_versions pv ON pv.version_id=(rm.manifest->>\'problemVersionId\') AND pv.competition_id=f.competition_id JOIN participants p ON p.id=f.participant_id JOIN users u ON u.id=p.user_id LEFT JOIN LATERAL(SELECT * FROM integrity_reports x WHERE x.selection_id=f.id ORDER BY x.review_revision DESC LIMIT 1) ir ON true LEFT JOIN score_revisions sc ON sc.id=s.published_score_id LEFT JOIN solving_timings st ON st.selection_id=f.id LEFT JOIN integrity_detections det ON det.selection_id=f.id LEFT JOIN LATERAL(SELECT failure_reason FROM evaluation_runs er WHERE er.selection_id=f.id AND er.purpose=\'CRITICAL_CONTEXT_REVIEW\' AND er.status=\'FAILED\' ORDER BY er.created_at DESC LIMIT 1) ctx ON true LEFT JOIN quality_evaluations q ON q.selection_id=f.id LEFT JOIN LATERAL(SELECT j FROM quality_human_reviews hr WHERE hr.selection_id=f.id ORDER BY hr.created_at DESC LIMIT 1) h ON true LEFT JOIN policy_reviews d ON d.id=s.effective_decision_id LEFT JOIN LATERAL(SELECT * FROM appeals x WHERE x.selection_id=f.id AND x.status=\'OPEN\' ORDER BY x.created_at DESC LIMIT 1) ap ON true WHERE f.competition_id=$1',[id])).rows;
   cases=rows.map(r=>({submissionId:r.submission_id,alias:r.alias,attemptId:r.attempt_id,prompt:r.prompt,answer:r.answer,status:r.status,automaticReview:r.selected_manifest?.reviewMode==='AUTOMATIC_REVIEWER',problemRevision:r.selected_manifest?.problemRevision||null,problemVersionId:r.selected_manifest?.problemVersionId||null,problemTitle:r.selected_problem?.title||null,problemStatement:r.selected_problem?.statement||null,score:currentScoreAvailable(r.status,r.score_decision_id,r.effective_decision_id)?r.score||null:null,solveElapsedMs:r.solve_elapsed_ms==null?null:num(r.solve_elapsed_ms),humanFallbackAvailable:!!r.detection&&!r.report&&!!r.context_failure,evidenceReady:!!r.detection,contextualFailure:r.context_failure||null,copyEvidence:(r.detection?.matches||[]).map((m:any)=>({quote:m.promptRange.quote,sourceQuote:m.sourceRange.quote,ruleId:(r.selected_registry?.items||registry.items).find((i:any)=>i.id===m.itemId)?.publicRuleId,classification:m.exempt?'PERMITTED_REUSE':'PROTECTED_CANDIDATE',promptStartByte:m.promptRange.startByte,promptEndByte:m.promptRange.endByte,sourceStartByte:m.sourceRange.startByte,sourceEndByte:m.sourceRange.endByte})),solutionEvaluation:r.solution_evaluation?{C:r.solution_evaluation.C,K:r.solution_evaluation.K,J:r.human_quality_j!=null?num(r.human_quality_j):r.quality_j!=null?num(r.quality_j):null,eligible:r.solution_evaluation.eligible}:undefined,qualityReviewRequired:!!r.needs_human_review&&r.human_quality_j==null,
    review:r.report?{verdict:r.report.verdict,reason:r.report.reasoning_summary,evidence:(r.detection?.matches||[]).map((m:any)=>({quote:m.promptRange.quote,sourceQuote:m.sourceRange.quote,ruleId:(r.selected_registry?.items||registry.items).find((i:any)=>i.id===m.itemId)?.publicRuleId,classification:m.exempt?'PERMITTED_REUSE':'PROTECTED_CANDIDATE'}))}:null,
    decision:r.verdict?{verdict:r.verdict,reason:r.reason,penalty:r.penalty,source:r.decision_mode==='AUTOMATIC_REVIEWER'?'AI_REVIEWER':'HUMAN',ruleIds:r.rule_ids||[]}:null,appeal:r.appeal_id?{id:r.appeal_id,reason:r.appeal_reason,status:r.appeal_status}:null}));
  }
  return {ranking:await competitionRanking(c,true),competition:await competitionView(c,u),participants:people.map(p=>({id:p.id,alias:p.alias,usedTokens:num(p.consumed),reservedTokens:num(p.reserved),state:p.workspace_state,moderationStatus:p.moderation_status,publicModerationNotice:p.public_moderation_notice||null,submissionId:p.submission_id||null})),
   registry:{versionId:c.registry_version_id,items:registry.items.map(i=>({id:i.id,category:i.category,text:i.text,explanation:i.explanation,publicRuleId:i.publicRuleId,severity:i.severity}))},cases,closed:!!c.closure_epoch,modelStatus:modelReadiness(c.manifest)};
 }
 async schedule(id:string,u:AppUser,body:{generationCutoff:string;selectionCutoff:string;revealAt:string}){
  const g=new Date(body.generationCutoff),s=new Date(body.selectionCutoff),r=new Date(body.revealAt);
  if(g<=new Date()||s<g||r<s)fail(400,'Use future generation, selection and reveal times in that order.');
  return transaction(async db=>{const c=await competitionRow(id,db,true);assertOrganizerScope(c,u);if(c.status!=='DRAFT')fail(409,'Published schedules are frozen.');await db.query('UPDATE competitions SET generation_cutoff=$2,selection_cutoff=$3,reveal_at=$4 WHERE id=$1',[id,g,s,r]);await audit(db,id,u.id,'DRAFT_SCHEDULE_UPDATED',body);return {ok:true};});
 }
 async registry(id:string,u:AppUser,items:any[]){
  return transaction(async db=>{
   const c=await competitionRow(id,db,true);assertOrganizerScope(c,u);if(c.status!=='DRAFT')fail(409,'Published registry bindings are immutable.');
   const old=await registryFor(c,db),byId=new Map(old.items.map(i=>[i.id,i])),nextId=randomUUID();
   const textBytes=Buffer.from(old.sourceText,'utf8');
   const nextItems:RegistryItem[]=items.map(i=>{
    const prior=byId.get(i.id);
    if(prior?.category==='REQUIRED_INFORMATION'&&i.category!=='REQUIRED_INFORMATION')fail(400,'Required facts must remain reusable.');
    if(i.category==='PRIVATE_EVALUATION_CRITERIA'){
     if(!prior||prior.category!=='PRIVATE_EVALUATION_CRITERIA')fail(400,'Private evaluation references cannot be created through public source editing.');
     return prior;
    }
    if(typeof i.text!=='string'||!i.text)fail(400,'A public registry item needs exact public source text.');
    const index=old.sourceText.indexOf(i.text);if(index<0)fail(400,'Registry text must occur in the public statement.');
    const start=i.sourceStartByte??Buffer.byteLength(old.sourceText.slice(0,index),'utf8'),end=i.sourceEndByte??start+Buffer.byteLength(i.text,'utf8');
    if(end<=start||end>textBytes.length||textBytes.subarray(start,end).toString('utf8')!==i.text)fail(400,'The original source byte range is invalid.');
    return {id:i.id,category:i.category,text:i.text,sourceStartByte:start,sourceEndByte:end,explanation:i.explanation,publicRuleId:i.publicRuleId,severity:i.severity};
   });
   for(const required of old.items.filter(i=>i.category==='REQUIRED_INFORMATION'))if(!nextItems.some(i=>i.id===required.id&&i.category==='REQUIRED_INFORMATION'&&i.text===required.text))fail(400,'Required fact registry entries cannot be removed.');
   const next:CriticalRegistry={...old,versionId:nextId,items:nextItems};
   try{validateRegistry(next);}catch{fail(400,'Registry source, protected rules or required-fact classifications conflict.');}
   const seq=num((await db.query('SELECT COALESCE(max(sequence),0)+1 AS sequence FROM registry_versions WHERE competition_id=$1',[id])).rows[0].sequence);
   await db.query('INSERT INTO registry_versions(id,competition_id,sequence,registry,digest) VALUES($1,$2,$3,$4,$5)',[nextId,id,seq,JSON.stringify(next),digest(next)]);
   await db.query('UPDATE competitions SET registry_version_id=$2 WHERE id=$1',[id,nextId]);await audit(db,id,u.id,'REGISTRY_DRAFT_VERSION_CREATED',{versionId:nextId});return {versionId:nextId};
  });
 }
 async start(id:string,u:AppUser){
  return transaction(async db=>{
   const c=await competitionRow(id,db,true);assertOrganizerScope(c,u);if(c.status!=='DRAFT')fail(409,'This competition is already published.');if(c.problem_deleted)fail(409,'Save a new problem before publishing this round.');
   if(!modelReadiness().ready)fail(409,'Configure the private OpenRouter key before publishing generation access.');
   if(!c.calibration&&!manifestQualified(c.manifest))fail(409,'Official provider/model qualification is required.');
   if(c.problem.kind==='STRUCTURED_JSON'){
    const p=c.problem,structured=p.structured;
    try{validateStructuredProblemDraft({kind:p.kind,title:p.title,statement:structured.baseStatement,objectives:structured.objectives,constraints:structured.constraints,requirements:structured.requirements,outputSchema:structured.outputSchema,checks:structured.checks,referenceAnswer:structured.referenceAnswer});}catch{fail(400,'Correct the structured output contract, requirement-linked checks or reference answer before publishing.');}
   }
   const registry=await registryFor(c,db);try{validateRegistry(registry);}catch{fail(400,'Correct the information registry before publication.');}
   const startedAt=(await db.query('SELECT clock_timestamp() AS now')).rows[0].now.toISOString();
   const problemRevision=num((await db.query('SELECT sequence FROM problem_versions WHERE competition_id=$1 AND version_id=$2',[id,c.problem.versionId])).rows[0]?.sequence||1);
   const rulesId=randomUUID(),manifest={...c.manifest,version:3,reviewMode:'AUTOMATIC_REVIEWER',rankingMode:'EARLIEST_CORRECT_TIEBREAK_V1',problemRevision,reviewPackage:REVIEW_PACKAGE,reviewPackageDigest:REVIEW_PACKAGE_DIGEST,reviewerModelVersionId:stableUuid(c.manifest.reviewerModel+':'+REVIEW_PACKAGE_DIGEST),systemEnvelope:GENERATION_ENVELOPE,competitionStartedAt:startedAt,qualificationEvidence:approvalFor(c.manifest),providerQualified:!!approvalFor(c.manifest),maxPromptBytes:config.maxPromptBytes,registryVersionId:c.registry_version_id,generationCutoff:c.generation_cutoff,selectionCutoff:c.selection_cutoff,revealAt:c.reveal_at};
   const seq=num((await db.query('SELECT max(sequence)+1 AS sequence FROM competition_rules_versions WHERE competition_id=$1',[id])).rows[0].sequence);
   await db.query('INSERT INTO competition_rules_versions(id,competition_id,sequence,manifest,digest) VALUES($1,$2,$3,$4,$5)',[rulesId,id,seq,JSON.stringify(manifest),digest(manifest)]);
   await db.query('UPDATE competitions SET status=\'GENERATION_OPEN\',rules_version_id=$2 WHERE id=$1',[id,rulesId]);
   await audit(db,id,u.id,'COMPETITION_PUBLISHED',{rulesVersionId:rulesId,registryVersionId:c.registry_version_id,calibration:c.calibration});return {ok:true};
  });
 }
 async close(id:string,u:AppUser|null){
  return transaction(async db=>{
   const c=await competitionRow(id,db,true);assertOrganizerScope(c,u);if(c.closure_epoch)return {ok:true,closureEpoch:c.closure_epoch};
   if(c.status!=='GENERATION_OPEN')fail(409,'Publish before closing the competition.');
   if(!c.calibration&&c.selection_cutoff&&(await db.query('SELECT clock_timestamp() AS now')).rows[0].now<c.selection_cutoff)fail(409,'The frozen selection window has not ended.');
   const people=(await db.query('SELECT p.*,t.reserved FROM participants p JOIN token_accounts t ON t.participant_id=p.id WHERE p.competition_id=$1 ORDER BY p.id FOR UPDATE OF p,t',[id])).rows;
   for(const p of people){
    await cancelQueued(db,p);const selected=(await db.query('SELECT id FROM final_selections WHERE participant_id=$1',[p.id])).rows[0];
    await db.query('UPDATE participants SET workspace_state=$2 WHERE id=$1',[p.id,selected?'FINALIZING':'NO_SUBMISSION']);
    await db.query('UPDATE token_accounts SET state=CASE WHEN state=\'ACCOUNTING_INCIDENT\' THEN state ELSE \'FINALIZING\' END WHERE participant_id=$1',[p.id]);
   }
   const ids=(await db.query('SELECT id FROM final_selections WHERE competition_id=$1 ORDER BY id',[id])).rows.map(r=>r.id);
   const epoch=randomUUID(),proof={epoch,enrollmentClosed:true,rosterFrozen:true,generationWindowClosed:true,selectionWindowClosed:true,allWorkspacesClosed:true};
   await db.query('INSERT INTO closure_proofs(epoch,competition_id,roster_digest,selected_ids,proof) VALUES($1,$2,$3,$4,$5)',[epoch,id,digest(people.map(p=>p.id)),JSON.stringify(ids),JSON.stringify(proof)]);
   await db.query('UPDATE competitions SET status=\'CLOSED\',closure_epoch=$2 WHERE id=$1',[id,epoch]);
   for(const selectionId of ids){await enqueue(db,'INTEGRITY',epoch+':'+selectionId,{selectionId,closureEpoch:epoch});await enqueue(db,'FINALIZE',epoch+':'+selectionId,{selectionId});}
   await audit(db,id,u?.id||null,'COMPETITION_SELECTION_CLOSED',{epoch,selectedIds:ids,manualCalibrationClose:!!u&&c.calibration});return {ok:true,closureEpoch:epoch};
  });
 }
 async decision(submissionId:string,u:AppUser,body:any,key:string){
  return transaction(async db=>{
   const scope=(await db.query('SELECT f.competition_id FROM submission_states s JOIN final_selections f ON f.id=s.selection_id WHERE s.id=$1',[submissionId])).rows[0];if(!scope)fail(404,'Submission not found.');
   await db.query('SELECT id FROM competitions WHERE id=$1 FOR SHARE',[scope.competition_id]);
   const s=(await db.query('SELECT s.*,f.competition_id FROM submission_states s JOIN final_selections f ON f.id=s.selection_id WHERE s.id=$1 FOR UPDATE OF s',[submissionId])).rows[0];
   const c=await competitionRow(s.competition_id,db);assertOrganizerScope(c,u);if(!c.closure_epoch)fail(409,'Integrity decisions start after competition-wide closure.');
   const old=await replay(db,u,'decision:'+submissionId,key,requestDigest(body));if(old)return old;
   const det=(await db.query('SELECT * FROM integrity_detections WHERE selection_id=$1',[s.selection_id])).rows[0];if(!det)fail(409,'Original selected-prompt evidence is still being prepared.');
   const report=(await db.query('SELECT * FROM integrity_reports WHERE selection_id=$1',[s.selection_id])).rows[0];
   const failure=(await db.query('SELECT failure_reason FROM evaluation_runs WHERE selection_id=$1 AND purpose=\'CRITICAL_CONTEXT_REVIEW\' AND status=\'FAILED\' ORDER BY created_at DESC LIMIT 1',[s.selection_id])).rows[0]?.failure_reason;
   if(!report&&!failure)fail(409,'Wait for review or a recorded human-fallback incident.');
   const selectedManifest=(await db.query('SELECT m.manifest FROM final_selections f JOIN attempts a ON a.id=f.attempt_id JOIN competition_rules_versions m ON m.id=a.rules_version_id WHERE f.id=$1',[s.selection_id])).rows[0]?.manifest;
   if(selectedManifest?.reviewMode==='AUTOMATIC_REVIEWER')fail(409,'This competition uses automatic reviewer decisions; manual copying penalties are unavailable.');
   const registry=await registryFor(c,db);let decision:any;
   try{decision=validateHumanIntegrityDecision({verdict:body.verdict,adjudicationMode:report?'MACHINE_ASSISTED':'HUMAN_ONLY',reviewedBy:u.id,reason:body.reason,reportId:report?.id||null,failureProvenance:failure,ruleId:body.ruleId,severity:body.severity||'NONE'},registry);}catch{fail(400,'Use a published rule/severity and an evidence-based human decision.');}
   if(decision.verdict==='CONFIRMED_VIOLATION'){
    const ids=registry.items.filter(i=>i.category==='PROTECTED_CRITICAL_INFORMATION'&&i.publicRuleId===body.ruleId).map(i=>i.id);
    if(!det.detection.matches.some((m:any)=>ids.includes(m.itemId)&&!m.exempt))fail(400,'No inspected protected-copy evidence supports this public rule.');
   }
   if(body.appealId&&!(await db.query('SELECT id FROM appeals WHERE id=$1 AND selection_id=$2 AND status=\'OPEN\'',[body.appealId,s.selection_id])).rowCount)fail(400,'The appeal does not belong to this open case.');
   const d=(await db.query('INSERT INTO policy_reviews(selection_id,actor_id,report_id,mode,verdict,rule_id,severity,reason,penalty,predecessor_id,failure_provenance) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id',[s.selection_id,u.id,report?.id||null,decision.adjudicationMode,decision.verdict,body.ruleId||null,body.severity||'NONE',body.reason,decision.penaltyPoints,s.effective_decision_id||null,failure||null])).rows[0];
   await db.query('UPDATE submission_states SET effective_decision_id=$2,status=\'PROCESSING\',updated_at=clock_timestamp() WHERE id=$1',[s.id,d.id]);
   if(body.appealId&&decision.verdict!=='INSUFFICIENT_EVIDENCE')await db.query('UPDATE appeals SET status=\'RESOLVED\',resolution_id=$2 WHERE id=$1',[body.appealId,d.id]);
   await enqueue(db,'FINALIZE',s.selection_id+':decision:'+d.id,{selectionId:s.selection_id});
   const result={decisionId:d.id,penalty:decision.penaltyPoints};await remember(db,u,'decision:'+submissionId,key,requestDigest(body),result);await audit(db,s.competition_id,u.id,'HUMAN_INTEGRITY_DECISION',{selectionId:s.selection_id,decisionId:d.id,verdict:decision.verdict,penalty:decision.penaltyPoints});return result;
  });
 }
 async qualityReview(submissionId:string,u:AppUser,scores:{clarity:number;justification:number;concision:number},reason:string){
  return transaction(async db=>{
   const s=(await db.query('SELECT s.*,f.competition_id FROM submission_states s JOIN final_selections f ON f.id=s.selection_id WHERE s.id=$1 FOR UPDATE OF s',[submissionId])).rows[0];if(!s)fail(404,'Submission not found.');
   const competition=await competitionRow(s.competition_id,db);assertOrganizerScope(competition,u);if(!competition.closure_epoch)fail(409,'Human quality review is available only after competition-wide closure.');
   if(competition.manifest.reviewMode==='AUTOMATIC_REVIEWER')fail(409,'Automatic competitions use model quality evaluation; manual grades are unavailable.');
   const J=(2*scores.clarity+2*scores.justification+scores.concision)/20;
   const evaluation=(await db.query('SELECT * FROM quality_evaluations WHERE selection_id=$1',[s.selection_id])).rows[0];
   if(!evaluation||!evaluation.needs_human_review)fail(409,'A recorded uncertain or unavailable quality evaluation is required.');
   const review=(await db.query('INSERT INTO quality_human_reviews(selection_id,actor_id,J,reason,ordinal_scores) VALUES($1,$2,$3,$4,$5) RETURNING id',[s.selection_id,u.id,J,reason,JSON.stringify(scores)])).rows[0];
   await enqueue(db,'FINALIZE',s.selection_id+':quality-human:'+review.id,{selectionId:s.selection_id});await audit(db,s.competition_id,u.id,'HUMAN_QUALITY_REVIEW',{selectionId:s.selection_id,reviewId:review.id,J});return {ok:true};
  });
 }
 async reveal(id:string,u:AppUser){
  return transaction(async db=>{
   const c=await competitionRow(id,db,true);assertOrganizerScope(c,u);if(!c.closure_epoch)fail(409,'Close all workspaces before revealing.');
   if(!c.calibration&&!manifestQualified(c.manifest))fail(409,'Official publication requires approved counting bounds and model qualification.');
   if(!c.calibration&&c.reveal_at&&(await db.query('SELECT clock_timestamp() AS now')).rows[0].now<c.reveal_at)fail(409,'The reveal time has not arrived.');
   const pending=(await db.query('SELECT count(*) FROM final_selections f JOIN submission_states s ON s.selection_id=f.id LEFT JOIN score_revisions sc ON sc.id=s.published_score_id WHERE f.competition_id=$1 AND (s.published_score_id IS NULL OR s.status<>\'FINALIZED\' OR sc.decision_id IS DISTINCT FROM s.effective_decision_id)',[id])).rows[0].count;
   if(num(pending)>0)fail(409,'Selected results still require usage settlement, quality evaluation or a resolved integrity decision.');
   await db.query('UPDATE competitions SET status=$2 WHERE id=$1',[id,c.calibration?'CALIBRATION_REVEALED':'REVEALED']);
   await audit(db,id,u.id,c.calibration?'CALIBRATION_RESULTS_REVEALED':'OFFICIAL_RESULTS_REVEALED',{qualified:config.officialQualified});return {ok:true,mode:c.calibration?'LOCAL_CALIBRATION':'OFFICIAL'};
  });
 }
}
