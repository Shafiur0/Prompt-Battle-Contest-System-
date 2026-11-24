import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { CompetitionProblem,CriticalRegistry } from '@prompt-battle/core';
import type { AppUser } from './auth';
import { pool } from './db';
import { modelReadiness } from './config';
import { fail } from './guards';
export { artifactDigest as digest,legacyRequestDigest as requestDigest } from './artifact-hash';
export const num=(v:unknown)=>Number(v);
export async function competitionRow(id:string,db:any=pool,lock=false){
 const r=await db.query('SELECT c.*,r.manifest FROM competitions c JOIN competition_rules_versions r ON r.id=c.rules_version_id WHERE c.id=$1'+(lock?' FOR UPDATE OF c':''),[id]);
 if(!r.rows[0])fail(404,'Competition not found.');return r.rows[0];
}
export async function membership(id:string,u:AppUser,db:any=pool,lock=false){
 const r=await db.query('SELECT p.*,t.allowance,t.consumed,t.reserved,t.state AS account_state FROM participants p JOIN token_accounts t ON t.participant_id=p.id WHERE p.competition_id=$1 AND p.user_id=$2'+(lock?' FOR UPDATE OF p,t':''),[id,u.id]);
 if(!r.rows[0])fail(403,'Enroll through your invited account first.');return r.rows[0];
}
export async function registryFor(c:any,db:any=pool):Promise<CriticalRegistry>{
 return (await db.query('SELECT registry FROM registry_versions WHERE id=$1 AND competition_id=$2',[c.registry_version_id,c.id])).rows[0].registry;
}
export async function competitionView(c:any,u:AppUser|null){
 const p=u?(await pool.query('SELECT p.*,s.id AS submission_id FROM participants p LEFT JOIN final_selections f ON f.participant_id=p.id LEFT JOIN submission_states s ON s.selection_id=f.id WHERE p.competition_id=$1 AND p.user_id=$2',[c.id,u.id])).rows[0]:null;
 const count=(await pool.query('SELECT count(*) FROM participants WHERE competition_id=$1',[c.id])).rows[0].count;
 const problem=c.problem as CompetitionProblem,registry=await registryFor(c);
 const generationBound=num(c.manifest.inputUpperBound)+num(c.manifest.maxOutputTokens);
 const protectedText=registry.items.filter(i=>i.category==='PROTECTED_CRITICAL_INFORMATION').map(i=>i.publicRuleId+': '+i.text).join('\n');
 return {id:c.id,title:c.title,status:c.status,reviewMode:c.manifest.reviewMode||'HUMAN_SIGNOFF',rankingMode:c.manifest.rankingMode||'QUALITY_TOKENS',problemRevision:c.manifest.problemRevision||null,problemVersionId:problem.versionId,capacity:c.capacity,participantCount:num(count),problemTitle:c.problem_deleted?'Problem not configured':problem.title,problemStatement:c.problem_deleted?'':problem.statement,problemDeleted:!!c.problem_deleted,moderationStatus:p?.moderation_status||'ACTIVE',publicModerationNotice:p?.public_moderation_notice||null,problemKind:c.problem_deleted?'NONE':problem.kind||'ALLOCATION',outputSchema:!c.problem_deleted&&problem.kind==='STRUCTURED_JSON'?problem.structured.outputSchema:undefined,
 outputContract:problem.publicRules.outputContract,copyingPolicy:'All necessary public facts, numbers, constraints and output keys may be reused. '+(protectedText?'Only the following explicitly designated nonessential passages are subject to the published direct-reproduction restrictions:\n'+protectedText:'This competition has no protected passages.')+'\nLegitimate paraphrases and required factual reuse are allowed. '+(c.manifest.reviewMode==='AUTOMATIC_REVIEWER'?'The selected final prompt is reviewed automatically after competition-wide closure. Published copying penalties are applied by the system.':'Every selected final prompt is reviewed after competition-wide closure and requires human sign-off.'),
 penaltySchedule:c.manifest.reviewMode==='AUTOMATIC_REVIEWER'?'No violation: 0 points. A minor violation confirmed by the automatic reviewer: 1 point. A material violation confirmed by the automatic reviewer: 3 points. Copying deductions are capped at 3 points per final submission.':problem.publicRules.penaltySchedule,generationModel:c.manifest.generationModel,qualityModel:c.manifest.qualityModel,reviewerModel:c.manifest.reviewerModel,
 generationCutoff:c.generation_cutoff?.toISOString()||null,selectionCutoff:c.selection_cutoff?.toISOString()||null,revealAt:c.reveal_at?.toISOString()||null,
 rulesVersionId:c.rules_version_id,tokenBudget:2000000,generationReservationTokens:Number.isSafeInteger(generationBound)&&generationBound>0?generationBound:null,modelReady:modelReadiness(c.manifest).ready,modelStatusText:modelReadiness(c.manifest).reason,promptByteLimit:c.manifest.maxPromptBytes||64000,member:!!p,workspaceState:p?.workspace_state||'NOT_ENROLLED',submissionId:p?.submission_id||null};
}
export async function replay(db:PoolClient,u:AppUser,operation:string,key:string,hash:string){
 const r=(await db.query('SELECT * FROM idempotency_records WHERE user_id=$1 AND operation=$2 AND key=$3',[u.id,operation,key])).rows[0];
 if(!r)return null;if(r.request_digest!==hash)fail(409,'This idempotency key belongs to a different request.');return r.response;
}
export async function remember(db:PoolClient,u:AppUser,operation:string,key:string,hash:string,response:unknown){
 await db.query('INSERT INTO idempotency_records(user_id,operation,key,request_digest,response) VALUES($1,$2,$3,$4,$5)',[u.id,operation,key,hash,JSON.stringify(response)]);
}
export async function cancelQueued(db:PoolClient,p:any){
 const calls=await db.query('SELECT pc.* FROM provider_calls pc JOIN attempts a ON a.id=pc.attempt_id WHERE a.participant_id=$1 AND pc.status=\'QUEUED\' FOR UPDATE OF pc',[p.id]);
 for(const call of calls.rows){
  await db.query('UPDATE provider_calls SET status=\'CANCELLED_UNBILLED\',completed_at=clock_timestamp() WHERE id=$1',[call.id]);
  await db.query('UPDATE token_accounts SET reserved=reserved-$2 WHERE participant_id=$1',[p.id,num(call.reserved_tokens)]);
  await db.query('INSERT INTO token_ledger_events(participant_id,provider_call_id,kind,reserved_delta,evidence) VALUES($1,$2,\'RELEASE\',$3,$4)',[p.id,call.id,-num(call.reserved_tokens),JSON.stringify({reason:'Cancelled before dispatch'})]);
  await db.query('UPDATE attempt_states SET status=\'CANCELLED_BEFORE_DISPATCH\' WHERE attempt_id=$1',[call.attempt_id]);
 }
}
export const attemptQuery='SELECT a.*,am.manifest->>\'problemVersionId\' AS problem_version_id,pv.sequence AS problem_revision,pv.content->>\'title\' AS problem_title,pv.content->>\'statement\' AS problem_statement,s.status,s.public_tests,s.public_summary,r.answer,u.input_tokens,u.output_tokens,u.total_tokens FROM attempts a JOIN attempt_states s ON s.attempt_id=a.id JOIN competition_rules_versions am ON am.id=a.rules_version_id LEFT JOIN problem_versions pv ON pv.competition_id=a.competition_id AND pv.version_id=(am.manifest->>\'problemVersionId\') LEFT JOIN responses r ON r.attempt_id=a.id LEFT JOIN LATERAL(SELECT sum(ur.input_tokens) AS input_tokens,sum(ur.output_tokens) AS output_tokens,sum(ur.total_tokens) AS total_tokens FROM provider_calls pc JOIN provider_usage_receipts ur ON ur.provider_call_id=pc.id WHERE pc.attempt_id=a.id) u ON true ';
export function attemptView(r:any,workspace:string){return {id:r.id,version:r.version,problemRevision:r.problem_revision==null?null:num(r.problem_revision),problemVersionId:r.problem_version_id||null,problemTitle:r.problem_title||null,problemStatement:r.problem_statement||null,prompt:r.prompt,status:r.status,answer:r.answer||null,inputTokens:r.input_tokens==null?null:num(r.input_tokens),outputTokens:r.output_tokens==null?null:num(r.output_tokens),totalTokens:r.total_tokens==null?null:num(r.total_tokens),createdAt:r.created_at.toISOString(),canSelect:!!r.answer&&workspace==='OPEN',publicTests:(r.public_tests||[]).map((t:any)=>({name:t.name,passed:t.passed,detail:t.detail})),evaluationSummary:(r.public_tests||[]).length?((r.public_tests||[]).every((t:any)=>t.passed)?'All public checks passed.':'Some public checks did not pass.'):null};}

export async function problemForManifest(competitionId:string,manifest:any,fallback:any,db:any=pool):Promise<CompetitionProblem>{
 let problem=fallback;
 if(manifest.problemVersionId){const p=(await db.query('SELECT content FROM problem_versions WHERE competition_id=$1 AND version_id=$2',[competitionId,manifest.problemVersionId])).rows[0];if(!p)throw new Error('Pinned problem version is unavailable');problem=p.content;}
 if(manifest.registryVersionId){const r=(await db.query('SELECT registry FROM registry_versions WHERE competition_id=$1 AND id=$2',[competitionId,manifest.registryVersionId])).rows[0];if(!r)throw new Error('Pinned registry version is unavailable');problem={...problem,registry:r.registry};}
 return problem;
}