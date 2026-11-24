import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AppUser } from './auth';
import { pool,transaction,audit,enqueue } from './db';
import { competitionRow,competitionView,membership,digest,requestDigest,num,replay,remember,cancelQueued,attemptQuery,attemptView } from './domain';
import { config,modelReadiness,manifestQualified } from './config';
import { fail } from './guards';
import { validatePromptInput,publishedResultVisible } from './invariants';
import { competitionRanking } from './ranking';
import { overallRanking } from './overall-ranking';
import { reserveAccount } from './budget';
@Injectable()
export class BattleService {
 async health(){await pool.query('SELECT 1');return {status:'ready',database:'connected',models:modelReadiness()};}
 async list(u:AppUser|null){
  const rows=await pool.query('SELECT c.*,r.manifest FROM competitions c JOIN competition_rules_versions r ON r.id=c.rules_version_id WHERE c.status<>\'DRAFT\' OR ($1 AND (c.organizer_id=$2 OR c.organizer_id IS NULL)) ORDER BY c.created_at',[!!u?.isOrganizer,u?.id||null]);
  return {competitions:await Promise.all(rows.rows.map(c=>competitionView(c,u)))};
 }
 async competition(id:string,u:AppUser|null){const c=await competitionRow(id);if(c.status==='DRAFT'&&(!u?.isOrganizer||(c.organizer_id&&c.organizer_id!==u.id)))fail(404,'Competition not found.');return competitionView(c,u);}
 async enroll(id:string,u:AppUser,body:{invitationCode?:string;rulesVersionId?:string}){
  return transaction(async db=>{
   const c=await competitionRow(id,db,true);
   if(c.status!=='GENERATION_OPEN'||(c.generation_cutoff&&Date.now()>=c.generation_cutoff.getTime()))fail(409,'Enrollment is closed.');
   if(body.rulesVersionId&&body.rulesVersionId!==c.rules_version_id)fail(409,'Review the current frozen rules before enrolling.');
   const old=(await db.query('SELECT id FROM participants WHERE competition_id=$1 AND user_id=$2',[id,u.id])).rows[0];if(old)return {participantId:old.id};
   const invite=(await db.query('SELECT * FROM invitations WHERE competition_id=$1 AND username=$2 AND expires_at>clock_timestamp() FOR UPDATE',[id,u.alias])).rows[0];
   if(!invite||invite.redeemed_by||(body.invitationCode&&invite.code_hash!==digest(body.invitationCode)))fail(403,'This account has no valid competition invitation.');
   if(num((await db.query('SELECT count(*) FROM participants WHERE competition_id=$1',[id])).rows[0].count)>=c.capacity)fail(409,'All competition seats are filled.');
   const p=(await db.query('INSERT INTO participants(competition_id,user_id) VALUES($1,$2) RETURNING id',[id,u.id])).rows[0];
   await db.query('INSERT INTO token_accounts(participant_id) VALUES($1)',[p.id]);
   await db.query('UPDATE invitations SET redeemed_by=$2 WHERE id=$1',[invite.id,u.id]);
   await audit(db,id,u.id,'PARTICIPANT_ENROLLED',{participantId:p.id,rulesVersionId:c.rules_version_id});return {participantId:p.id};
  });
 }
 async account(id:string,u:AppUser){const p=await membership(id,u);return {allowance:num(p.allowance),confirmedUsed:num(p.consumed),reserved:num(p.reserved),available:Math.max(0,num(p.allowance)-num(p.consumed)-num(p.reserved)),state:p.account_state};}
 async createAttempt(id:string,u:AppUser,body:{prompt:string;parentAttemptId?:string},key:string){
  try{validatePromptInput(body.prompt);}catch{fail(400,'Keep the prompt within the published 64,000 UTF-8 byte limit and use valid text.');}
  return transaction(async db=>{
   await db.query('SELECT id FROM competitions WHERE id=$1 FOR SHARE',[id]);
   const c=await competitionRow(id,db),p=await membership(id,u,db,true),op='attempt:'+id,hash=requestDigest(body);
   const previous=await replay(db,u,op,key,hash);if(previous)return previous;
   if(!modelReadiness().ready)fail(409,'Add the private server OpenRouter key before generating.');
   if(p.moderation_status==='BANNED')fail(403,p.public_moderation_notice||'Your participation is paused by a human organizer.');
   if(c.status!=='GENERATION_OPEN'||p.workspace_state!=='OPEN'||p.account_state!=='OPEN')fail(409,'This workspace is closed to generation.');
   if(c.generation_cutoff&&(await db.query('SELECT clock_timestamp() AS now')).rows[0].now>=c.generation_cutoff)fail(409,'The generation deadline passed.');
   if(!c.calibration&&!manifestQualified(c.manifest))fail(409,'Provider qualification is required for official competition.');
   if(num(p.reserved)>0)fail(409,'Wait for the existing provider request and usage to settle.');
   if(num((await db.query('SELECT count(*) FROM attempts WHERE participant_id=$1 AND created_at>clock_timestamp()-interval \'1 minute\'',[p.id])).rows[0].count)>=5)fail(429,'Wait before another generation request.');
   if(body.parentAttemptId&&!(await db.query('SELECT id FROM attempts WHERE id=$1 AND participant_id=$2 AND competition_id=$3',[body.parentAttemptId,p.id,id])).rowCount)fail(404,'Parent attempt not found.');
   const held=num(c.manifest.inputUpperBound)+num(c.manifest.maxOutputTokens);
   if(!Number.isSafeInteger(held)||held<=0||num(p.consumed)+num(p.reserved)+held>num(p.allowance))fail(409,'The remaining budget cannot reserve this request.');
   const version=num((await db.query('SELECT COALESCE(max(version),0)+1 AS v FROM attempts WHERE participant_id=$1',[p.id])).rows[0].v),attemptId=randomUUID(),callId=randomUUID();
   await db.query('INSERT INTO attempts(id,competition_id,participant_id,version,prompt,prompt_hash,parent_attempt_id,rules_version_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[attemptId,id,p.id,version,body.prompt,digest(body.prompt),body.parentAttemptId||null,c.rules_version_id]);
   await db.query('INSERT INTO attempt_states(attempt_id) VALUES($1)',[attemptId]);
   await db.query('INSERT INTO provider_calls(id,purpose,attempt_id,request_digest,model,provider,request_id,reserved_tokens) VALUES($1::uuid,\'GENERATION\',$2,$3,$4,$5,$7::text,$6)',[callId,attemptId,hash,c.manifest.generationModel,c.manifest.generationProvider,held,callId]);
   if(!await reserveAccount(db,p.id,held))fail(409,'The account cannot reserve this request.');
   await db.query('INSERT INTO token_ledger_events(participant_id,provider_call_id,kind,reserved_delta,evidence) VALUES($1,$2,\'RESERVE\',$3,$4)',[p.id,callId,held,JSON.stringify({inputBound:c.manifest.inputUpperBound,maxOutput:c.manifest.maxOutputTokens,qualified:config.officialQualified})]);
   await enqueue(db,'GENERATE',callId,{callId,attemptId});
   const result={attemptId,version,status:'QUEUED',reservedTokens:held};await remember(db,u,op,key,hash,result);
   await audit(db,id,u.id,'ATTEMPT_ADMITTED',{attemptId,callId,held,version});return result;
  });
 }
 async attempts(id:string,u:AppUser){const p=await membership(id,u);const rows=await pool.query(attemptQuery+'WHERE a.participant_id=$1 ORDER BY a.version',[p.id]);return {attempts:rows.rows.map(a=>attemptView(a,p.workspace_state))};}
 async attempt(id:string,u:AppUser){const row=(await pool.query(attemptQuery+'JOIN participants p ON p.id=a.participant_id WHERE a.id=$1 AND p.user_id=$2',[id,u.id])).rows[0];if(!row)fail(404,'Attempt not found.');const p=await membership(row.competition_id,u);return attemptView(row,p.workspace_state);}
 async select(id:string,u:AppUser,body:{attemptId:string},key:string){
  return transaction(async db=>{
   await db.query('SELECT id FROM competitions WHERE id=$1 FOR SHARE',[id]);
   const c=await competitionRow(id,db),p=await membership(id,u,db,true),op='select:'+id,hash=requestDigest(body);
   const previous=await replay(db,u,op,key,hash);if(previous)return previous;
   if(p.moderation_status==='BANNED')fail(403,p.public_moderation_notice||'Your participation is paused by a human organizer.');
   if(c.status!=='GENERATION_OPEN'||p.workspace_state!=='OPEN')fail(409,'The final choice is locked or competition is closed.');
   if(c.selection_cutoff&&(await db.query('SELECT clock_timestamp() AS now')).rows[0].now>=c.selection_cutoff)fail(409,'The selection deadline passed.');
   const a=(await db.query('SELECT a.id,r.id AS response_id FROM attempts a JOIN responses r ON r.attempt_id=a.id WHERE a.id=$1 AND a.participant_id=$2 AND a.competition_id=$3',[body.attemptId,p.id,id])).rows[0];if(!a)fail(409,'Select an owned attempt with a complete immutable answer.');
   const f=(await db.query('INSERT INTO final_selections(competition_id,participant_id,attempt_id,response_id) VALUES($1,$2,$3,$4) RETURNING id',[id,p.id,a.id,a.response_id])).rows[0];
   const s=(await db.query('INSERT INTO submission_states(selection_id) VALUES($1) RETURNING id',[f.id])).rows[0];
   await db.query('UPDATE participants SET workspace_state=\'FINALIZING\' WHERE id=$1',[p.id]);
   await db.query('UPDATE token_accounts SET state=CASE WHEN state=\'ACCOUNTING_INCIDENT\' THEN state ELSE \'FINALIZING\' END WHERE participant_id=$1',[p.id]);await cancelQueued(db,p);
   await enqueue(db,'QUALITY',f.id,{selectionId:f.id});await enqueue(db,'FINALIZE',f.id+':selection',{selectionId:f.id});
   const result={submissionId:s.id};await remember(db,u,op,key,hash,result);await audit(db,id,u.id,'FINAL_SELECTION_COMMITTED',{selectionId:f.id,attemptId:a.id});return result;
  });
 }
 async submission(id:string,u:AppUser){
  const r=(await pool.query('SELECT s.*,f.attempt_id,c.status AS competition_status,sc.decision_id AS score_decision_id,sc.score,d.reason,d.penalty,d.mode AS decision_mode,d.rule_ids FROM submission_states s JOIN final_selections f ON f.id=s.selection_id JOIN participants p ON p.id=f.participant_id JOIN competitions c ON c.id=f.competition_id LEFT JOIN score_revisions sc ON sc.id=s.published_score_id LEFT JOIN policy_reviews d ON d.id=s.effective_decision_id WHERE s.id=$1 AND p.user_id=$2',[id,u.id])).rows[0];if(!r)fail(404,'Submission not found.');
  const visible=publishedResultVisible(r.competition_status,r.status,r.score_decision_id,r.effective_decision_id);
  return {id:r.id,attemptId:r.attempt_id,status:visible&&r.score?'FINALIZED':r.status==='FINALIZED'?'PROCESSING':r.status,score:visible?r.score||null:null,integrityNotice:visible&&r.reason?{reason:r.reason,penalty:r.penalty,source:r.decision_mode==='AUTOMATIC_REVIEWER'?'AI_REVIEWER':'HUMAN',ruleIds:r.rule_ids||[]}:null};
 }
 async leaderboard(id:string){return competitionRanking(await competitionRow(id));}
 async overallLeaderboard(includeSamples=false){return overallRanking(includeSamples);}
 async appeal(id:string,u:AppUser,reason:string,key:string){
  return transaction(async db=>{
   const s=(await db.query('SELECT s.*,f.competition_id FROM submission_states s JOIN final_selections f ON f.id=s.selection_id JOIN participants p ON p.id=f.participant_id WHERE s.id=$1 AND p.user_id=$2 FOR UPDATE OF s',[id,u.id])).rows[0];if(!s)fail(404,'Submission not found.');
   const old=await replay(db,u,'appeal:'+id,key,requestDigest({reason}));if(old)return old;
   const c=await competitionRow(s.competition_id,db);if(!['REVEALED','CALIBRATION_REVEALED'].includes(c.status)||!s.effective_decision_id)fail(409,'Appeals open after the evaluation decision is revealed.');
   if((await db.query('SELECT id FROM appeals WHERE selection_id=$1 AND status=\'OPEN\'',[s.selection_id])).rowCount)fail(409,'An appeal is already open.');
   const a=(await db.query('INSERT INTO appeals(selection_id,challenged_decision_id,user_id,reason) VALUES($1,$2,$3,$4) RETURNING id',[s.selection_id,s.effective_decision_id,u.id,reason])).rows[0];
   if(c.manifest.reviewMode==='AUTOMATIC_REVIEWER'){await db.query("UPDATE submission_states SET status='PROCESSING',updated_at=clock_timestamp() WHERE id=$1",[id]);await enqueue(db,'AUTOMATIC_APPEAL',a.id,{selectionId:s.selection_id,closureEpoch:c.closure_epoch,appealId:a.id});}
   const result={appealId:a.id};await remember(db,u,'appeal:'+id,key,requestDigest({reason}),result);await audit(db,s.competition_id,u.id,'APPEAL_REQUESTED',{appealId:a.id});return result;
  });
 }
}
