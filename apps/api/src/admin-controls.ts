import { Injectable } from '@nestjs/common';
import {competitionRanking,rankingPosition} from './ranking';
import {currentScoreAvailable} from './invariants';
import { randomUUID } from 'node:crypto';
import type { AppUser } from './auth';
import { pool,transaction,audit } from './db';
import { competitionRow,membership,cancelQueued,num,attemptQuery,attemptView } from './domain';
import { assertOrganizerScope } from './create-competition';
import { fail } from './guards';
@Injectable()
export class AdminControlsService {
 async removeProblem(id:string,u:AppUser){
  return transaction(async db=>{const c=await competitionRow(id,db,true);assertOrganizerScope(c,u);if(c.status!=='DRAFT')fail(409,'Published problems cannot be deleted. Create a new round instead.');await db.query('UPDATE competitions SET problem_deleted=true WHERE id=$1',[id]);await audit(db,id,u.id,'DRAFT_PROBLEM_LOGICALLY_REMOVED',{retainedVersionId:c.problem.versionId});return {ok:true};});
 }
 async announcements(id:string,u:AppUser,owner=false){
  const c=await competitionRow(id);if(owner)assertOrganizerScope(c,u);else await membership(id,u);
  const rows=await pool.query('SELECT a.id,a.message,a.created_at,s.withdrawn_at FROM announcements a JOIN announcement_states s ON s.announcement_id=a.id WHERE a.competition_id=$1'+(owner?'':' AND s.withdrawn_at IS NULL')+' ORDER BY a.created_at DESC',[id]);
  return {announcements:rows.rows.map(a=>({id:a.id,message:a.message,createdAt:a.created_at.toISOString(),withdrawn:!!a.withdrawn_at,scope:'OPERATIONAL',doesNotAmendRules:true}))};
 }
 async postAnnouncement(id:string,u:AppUser,message:string){
  return transaction(async db=>{const c=await competitionRow(id,db,true);assertOrganizerScope(c,u);const announcementId=randomUUID();await db.query('INSERT INTO announcements(id,competition_id,actor_id,message) VALUES($1,$2,$3,$4)',[announcementId,id,u.id,message]);await db.query('INSERT INTO announcement_states(announcement_id) VALUES($1)',[announcementId]);await audit(db,id,u.id,'ANNOUNCEMENT_POSTED',{announcementId,scope:'OPERATIONAL',rulesVersionId:c.rules_version_id});return {id:announcementId};});
 }
 async withdrawAnnouncement(id:string,announcementId:string,u:AppUser){
  return transaction(async db=>{const c=await competitionRow(id,db,true);assertOrganizerScope(c,u);const row=(await db.query('SELECT id FROM announcements WHERE id=$1 AND competition_id=$2',[announcementId,id])).rows[0];if(!row)fail(404,'Announcement not found.');await db.query('UPDATE announcement_states SET withdrawn_at=COALESCE(withdrawn_at,clock_timestamp()) WHERE announcement_id=$1',[announcementId]);await audit(db,id,u.id,'ANNOUNCEMENT_WITHDRAWN',{announcementId});return {ok:true};});
 }
 async participant(id:string,pid:string,u:AppUser){
  const c=await competitionRow(id);assertOrganizerScope(c,u);
  const p=(await pool.query('SELECT p.*,u.alias,t.allowance,t.consumed,t.reserved,t.state AS account_state,s.id AS submission_id FROM participants p JOIN users u ON u.id=p.user_id JOIN token_accounts t ON t.participant_id=p.id LEFT JOIN final_selections f ON f.participant_id=p.id LEFT JOIN submission_states s ON s.selection_id=f.id WHERE p.id=$1 AND p.competition_id=$2',[pid,id])).rows[0];if(!p)fail(404,'Participant not found.');
  const rows=(await pool.query(attemptQuery+'WHERE a.participant_id=$1 ORDER BY a.version',[pid])).rows;
  const evaluation=c.closure_epoch?(await pool.query('SELECT s.status AS submission_status,s.effective_decision_id,sc.decision_id AS score_decision_id,d.verdict,d.reason,d.penalty,d.mode,d.rule_ids,sc.score,st.elapsed_ms,st.first_correct_at FROM final_selections f JOIN submission_states s ON s.selection_id=f.id LEFT JOIN policy_reviews d ON d.id=s.effective_decision_id LEFT JOIN score_revisions sc ON sc.id=s.published_score_id LEFT JOIN solving_timings st ON st.selection_id=f.id WHERE f.participant_id=$1 AND f.competition_id=$2',[pid,id])).rows[0]:null;
  return {ranking:c.closure_epoch?rankingPosition(await competitionRanking(c,true),pid):null,evaluation:evaluation?{verdict:evaluation.verdict,reason:evaluation.reason,penalty:evaluation.penalty,source:evaluation.mode==='AUTOMATIC_REVIEWER'?'AI_REVIEWER':'HUMAN',ruleIds:evaluation.rule_ids||[],score:currentScoreAvailable(evaluation.submission_status,evaluation.score_decision_id,evaluation.effective_decision_id)?evaluation.score:null,solveElapsedMs:evaluation.elapsed_ms==null?null:num(evaluation.elapsed_ms),firstCorrectAt:evaluation.first_correct_at?.toISOString()||null}:null,id:p.id,alias:p.alias,workspaceState:p.workspace_state,moderationStatus:p.moderation_status,publicModerationNotice:p.public_moderation_notice||null,wallet:{allowance:num(p.allowance),confirmedUsed:num(p.consumed),reserved:num(p.reserved),available:Math.max(0,num(p.allowance)-num(p.consumed)-num(p.reserved)),state:p.account_state},submissionId:p.submission_id||null,historyAvailable:!!c.closure_epoch,
   attempts:rows.map(r=>{const v=attemptView(r,p.workspace_state);return c.closure_epoch?v:{id:v.id,version:v.version,status:v.status,inputTokens:v.inputTokens,outputTokens:v.outputTokens,totalTokens:v.totalTokens,createdAt:v.createdAt};})};
 }
 async moderate(id:string,pid:string,u:AppUser,action:'BAN'|'UNBAN',body:{reason:string;publicNotice:string;confirmedFinding?:string}){
  return transaction(async db=>{
   const c=await competitionRow(id,db,true);assertOrganizerScope(c,u);
   const p=(await db.query('SELECT p.*,t.reserved FROM participants p JOIN token_accounts t ON t.participant_id=p.id WHERE p.id=$1 AND p.competition_id=$2 FOR UPDATE OF p,t',[pid,id])).rows[0];if(!p)fail(404,'Participant not found.');
   if(action==='BAN'&&(!body.confirmedFinding||body.confirmedFinding.trim().length<8))fail(400,'A recorded human-confirmed finding is required; an AI flag is not an automatic ban.');
   if(action==='BAN'&&/^[a-f0-9-]{36}$/i.test(body.confirmedFinding||'')){
    const decision=(await db.query('SELECT d.id FROM policy_reviews d JOIN final_selections f ON f.id=d.selection_id WHERE d.id=$1 AND f.participant_id=$2 AND f.competition_id=$3 AND d.verdict=\'CONFIRMED_VIOLATION\'',[body.confirmedFinding,pid,id])).rows[0];
    if(!decision)fail(400,'The referenced confirmed human decision does not belong to this participant and competition.');
   }
   const eventId=randomUUID(),notice=body.publicNotice.trim()||(action==='BAN'?'Your participation has been paused by a human organizer.':'Participation restored by a human organizer.');
   await db.query('INSERT INTO moderation_events(id,competition_id,participant_id,actor_id,action,reason,public_notice,confirmed_finding) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[eventId,id,pid,u.id,action,body.reason,notice,body.confirmedFinding||null]);
   await db.query('UPDATE participants SET moderation_status=$2,public_moderation_notice=$3 WHERE id=$1',[pid,action==='BAN'?'BANNED':'ACTIVE',action==='UNBAN'&&!body.publicNotice.trim()?null:notice]);
   if(action==='BAN')await cancelQueued(db,p);
   await audit(db,id,u.id,action==='BAN'?'HUMAN_PARTICIPANT_BANNED':'HUMAN_PARTICIPANT_UNBANNED',{eventId,participantId:pid,humanActorId:u.id,workspaceRetained:p.workspace_state,noUsageRefund:true});
   return {eventId,moderationStatus:action==='BAN'?'BANNED':'ACTIVE'};
  });
 }
}
