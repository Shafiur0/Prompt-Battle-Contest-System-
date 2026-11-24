import test,{before,after} from 'node:test';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { SAMPLE_PROBLEM } from '@prompt-battle/core';
import { artifactDigest,canonicalJson,legacyRequestDigest } from '../artifact-hash';
process.env.NODE_ENV='test';process.env.OPENROUTER_API_KEY='test-fixture-no-provider';process.env.OFFICIAL_PROVIDER_QUALIFIED='false';
const schema='controls_regression_'+randomUUID().replace(/-/g,'');
const url=process.env.TEST_DATABASE_URL||'postgresql://prompt_battle:local-development-only@localhost:5432/prompt_battle';
const admin=new Pool({connectionString:url}),comp=randomUUID(),rules=randomUUID(),registry=randomUUID(),pid=randomUUID();
const owner={id:randomUUID(),alias:'owner-fixture',isOrganizer:true},other={id:randomUUID(),alias:'other-fixture',isOrganizer:true},learner={id:randomUUID(),alias:'learner-fixture',isOrganizer:false};
let pool:any,controls:any,battle:any,organizer:any,editor:any;
before(async()=>{
 pool=(await import('../db')).pool;Object.assign(pool.options,{connectionString:url,options:'-c search_path='+schema});
 await admin.query('CREATE SCHEMA "'+schema+'"');
 const tables=(await admin.query("SELECT table_name FROM information_schema.tables WHERE table_schema='battle' AND table_type='BASE TABLE'")).rows;
 for(const t of tables){if(!/^[a-z_]+$/.test(t.table_name))throw new Error('Unsafe fixture table');await admin.query('CREATE TABLE "'+schema+'"."'+t.table_name+'" (LIKE battle."'+t.table_name+'" INCLUDING ALL)');}
 await admin.query('CREATE FUNCTION "'+schema+'".append_audit(c uuid,a uuid,k text,p jsonb) RETURNS void LANGUAGE sql AS $$ SELECT battle.append_audit(c,a,k,p) $$');
 for(const t of ['announcements','moderation_events'])await admin.query('CREATE TRIGGER fixture_immutable BEFORE UPDATE OR DELETE ON "'+schema+'"."'+t+'" FOR EACH ROW EXECUTE FUNCTION battle.reject_immutable_change()');
 for(const u of [owner,other,learner])await admin.query('INSERT INTO "'+schema+'".users(id,issuer,subject,alias,is_organizer) VALUES($1,\'fixture\',$2,$2,$3)',[u.id,u.alias,u.isOrganizer]);
 await admin.query('INSERT INTO "'+schema+'".competitions(id,title,problem,rules_version_id,registry_version_id,organizer_id,generation_cutoff,selection_cutoff) VALUES($1,\'Fixture\',$2,$3,$4,$5,clock_timestamp()+interval \'1 hour\',clock_timestamp()+interval \'2 hours\')',[comp,JSON.stringify(SAMPLE_PROBLEM),rules,registry,owner.id]);
 await admin.query('INSERT INTO "'+schema+'".competition_rules_versions(id,competition_id,sequence,manifest,digest) VALUES($1,$2,1,$3,$4)',[rules,comp,JSON.stringify({generationModel:'fixture-model',qualityModel:'fixture-quality',reviewerModel:'fixture-reviewer',generationProvider:'fixture-provider',reviewProvider:'fixture-provider',inputUpperBound:1024,maxOutputTokens:128,maxPromptBytes:64000,systemEnvelope:'Fixture'}),'fixture']);
 await admin.query('INSERT INTO "'+schema+'".registry_versions(id,competition_id,sequence,registry,digest) VALUES($1,$2,1,$3,\'fixture\')',[registry,comp,JSON.stringify(SAMPLE_PROBLEM.registry)]);
 await admin.query('INSERT INTO "'+schema+'".problem_versions(id,competition_id,version_id,sequence,content,digest) VALUES($1,$2,$3,1,$4,\'fixture\')',[randomUUID(),comp,SAMPLE_PROBLEM.versionId,JSON.stringify(SAMPLE_PROBLEM)]);
 await admin.query('INSERT INTO "'+schema+'".participants(id,competition_id,user_id) VALUES($1,$2,$3)',[pid,comp,learner.id]);await admin.query('INSERT INTO "'+schema+'".token_accounts(participant_id) VALUES($1)',[pid]);
 controls=new (await import('../admin-controls')).AdminControlsService();battle=new (await import('../service')).BattleService();organizer=new (await import('../organizer')).OrganizerService();editor=new (await import('../problem-editor')).ProblemEditorService();
});
after(async()=>{await pool?.end();if(!/^controls_regression_[a-f0-9]{32}$/.test(schema))throw new Error('Unsafe cleanup');await admin.query('DROP SCHEMA "'+schema+'" CASCADE');await admin.end();});
test('draft removal is logical, owner-only, blocks start and retains immutable snapshots',async()=>{
 await assert.rejects(controls.removeProblem(comp,other),/another organizer/);await controls.removeProblem(comp,owner);
 const view=await editor.get(comp,owner);assert.equal(view.deleted,true);assert.equal(view.problemKind,'NONE');assert.equal(view.draft,null);
 assert.equal(Number((await admin.query('SELECT count(*) FROM "'+schema+'".problem_versions')).rows[0].count),1);
 await assert.rejects(organizer.start(comp,owner),/Save a new problem/);
 const row=(await admin.query('SELECT problem FROM "'+schema+'".competitions WHERE id=$1',[comp])).rows[0];assert.equal(row.problem.versionId,SAMPLE_PROBLEM.versionId);
 await admin.query('UPDATE "'+schema+'".competitions SET problem_deleted=false,status=\'GENERATION_OPEN\' WHERE id=$1',[comp]);
 await assert.rejects(controls.removeProblem(comp,owner),/Published problems cannot be deleted/);
});
test('operational announcements are immutable, per-round and withdraw without changing rules',async()=>{
 const before=(await admin.query('SELECT rules_version_id FROM "'+schema+'".competitions WHERE id=$1',[comp])).rows[0].rules_version_id;
 await assert.rejects(controls.postAnnouncement(comp,learner,'Unauthorized'),/another organizer/);
 const a=await controls.postAnnouncement(comp,owner,'Operational fixture notice; frozen rules still apply.');
 assert.equal((await controls.announcements(comp,learner)).announcements.length,1);
 await assert.rejects(controls.withdrawAnnouncement(comp,a.id,other),/another organizer/);
 await controls.withdrawAnnouncement(comp,a.id,owner);
 assert.equal((await controls.announcements(comp,learner)).announcements.length,0);
 const archived=(await controls.announcements(comp,owner,true)).announcements;assert.equal(archived.length,1);assert.equal(archived[0].withdrawn,true);
 await assert.rejects(admin.query('UPDATE "'+schema+'".announcements SET message=\'tampered\' WHERE id=$1',[a.id]),/Immutable/);
 assert.equal((await admin.query('SELECT rules_version_id FROM "'+schema+'".competitions WHERE id=$1',[comp])).rows[0].rules_version_id,before);
});
test('human ban cancels only queued work and blocks generation/final selection without refunds',async()=>{
 const a=await battle.createAttempt(comp,learner,{prompt:'Synthetic queued fixture.'},randomUUID());
 await assert.rejects(controls.moderate(comp,pid,other,'BAN',{reason:'Private',publicNotice:'Paused',confirmedFinding:'Human inspected fixture evidence'}),/another organizer/);
 await controls.moderate(comp,pid,owner,'BAN',{reason:'Private human reason',publicNotice:'Participation paused.',confirmedFinding:'Human inspected fixture evidence'});
 const p=(await admin.query('SELECT workspace_state,moderation_status FROM "'+schema+'".participants WHERE id=$1',[pid])).rows[0];assert.equal(p.workspace_state,'OPEN');assert.equal(p.moderation_status,'BANNED');
 const wallet=(await admin.query('SELECT consumed,reserved,state FROM "'+schema+'".token_accounts')).rows[0];assert.equal(Number(wallet.consumed),0);assert.equal(Number(wallet.reserved),0);assert.equal(wallet.state,'OPEN');
 const call=(await admin.query('SELECT status FROM "'+schema+'".provider_calls WHERE attempt_id=$1',[a.attemptId])).rows[0];assert.equal(call.status,'CANCELLED_UNBILLED');
 await assert.rejects(battle.createAttempt(comp,learner,{prompt:'Banned fixture.'},randomUUID()),/Participation paused/);
 await assert.rejects(battle.select(comp,learner,{attemptId:a.attemptId},randomUUID()),/Participation paused/);
 const board=await battle.leaderboard(comp);assert.equal(board.rows[0].status,'BANNED');assert.equal(board.rows[0].rank,null);
});
test('participant details hide all prompt/answer fields before global closure and private reasons stay private',async()=>{
 const detail=await controls.participant(comp,pid,owner);assert.equal(detail.historyAvailable,false);assert.ok(detail.attempts.length>0);assert.ok(!Object.hasOwn(detail.attempts[0],'prompt'));assert.ok(!Object.hasOwn(detail.attempts[0],'answer'));
 await assert.rejects(controls.participant(comp,pid,other),/another organizer/);
 const own=await battle.competition(comp,learner);assert.equal(own.moderationStatus,'BANNED');assert.equal(own.publicModerationNotice,'Participation paused.');assert.ok(!JSON.stringify(own).includes('Private human reason'));
});
test('in-flight holds survive bans and unban never reopens a sealed workspace or refunds usage',async()=>{
 await controls.moderate(comp,pid,owner,'UNBAN',{reason:'Human release',publicNotice:'Participation restored.'});
 const admitted=await battle.createAttempt(comp,learner,{prompt:'Synthetic in-flight fixture.'},randomUUID());
 await admin.query('UPDATE "'+schema+'".provider_calls SET status=\'DISPATCHING\' WHERE attempt_id=$1',[admitted.attemptId]);
 await controls.moderate(comp,pid,owner,'BAN',{reason:'Private second reason',publicNotice:'Paused again.',confirmedFinding:'New human-confirmed fixture finding'});
 const held=(await admin.query('SELECT reserved FROM "'+schema+'".token_accounts')).rows[0];assert.equal(Number(held.reserved),1152);
 await admin.query('UPDATE "'+schema+'".participants SET workspace_state=\'FINALIZED\' WHERE id=$1',[pid]);await admin.query('UPDATE "'+schema+'".token_accounts SET state=\'FINALIZED\' WHERE participant_id=$1',[pid]);
 await controls.moderate(comp,pid,owner,'UNBAN',{reason:'Appeal release',publicNotice:'Restored after human review.'});
 const row=(await admin.query('SELECT p.workspace_state,p.moderation_status,t.state,t.reserved FROM "'+schema+'".participants p JOIN "'+schema+'".token_accounts t ON t.participant_id=p.id WHERE p.id=$1',[pid])).rows[0];assert.equal(row.workspace_state,'FINALIZED');assert.equal(row.state,'FINALIZED');assert.equal(row.moderation_status,'ACTIVE');assert.equal(Number(row.reserved),1152);
});
test('new canonical object digests replay after PostgreSQL JSONB normalization while strings/request hashes stay compatible',async()=>{
 const raw={z:[3,{b:2,a:1}],a:'Unicode • fixture',m:{y:true,x:null}};
 const normalized=(await admin.query('SELECT $1::jsonb AS value',[JSON.stringify(raw)])).rows[0].value;
 assert.equal(artifactDigest(raw),artifactDigest(normalized));assert.equal(canonicalJson(raw),canonicalJson(normalized));
 assert.equal(artifactDigest('plain fixture'),legacyRequestDigest('plain fixture'));
});

test('real enrollment serializes the tenth seat and rejects an eleventh valid invite without a wallet',async()=>{
 for(let i=0;i<8;i++){
  const uid=randomUUID(),newPid=randomUUID();await admin.query('INSERT INTO "'+schema+'".users(id,issuer,subject,alias) VALUES($1,\'seat-fixture\',$2,$2)',[uid,'seat-existing-'+i]);
  await admin.query('INSERT INTO "'+schema+'".participants(id,competition_id,user_id) VALUES($1,$2,$3)',[newPid,comp,uid]);await admin.query('INSERT INTO "'+schema+'".token_accounts(participant_id) VALUES($1)',[newPid]);
 }
 const candidates=[{id:randomUUID(),alias:'seat-last-a',isOrganizer:false},{id:randomUUID(),alias:'seat-last-b',isOrganizer:false}];
 for(const c of candidates){await admin.query('INSERT INTO "'+schema+'".users(id,issuer,subject,alias) VALUES($1,\'seat-fixture\',$2,$2)',[c.id,c.alias]);await admin.query('INSERT INTO "'+schema+'".invitations(competition_id,code_hash,username,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval \'1 hour\')',[comp,'seat-'+c.alias,c.alias]);}
 const outcomes=await Promise.allSettled(candidates.map(c=>battle.enroll(comp,c,{rulesVersionId:rules})));
 assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);assert.equal(outcomes.filter(o=>o.status==='rejected').length,1);
 const denied=outcomes.find(o=>o.status==='rejected') as PromiseRejectedResult;assert.match(String(denied.reason),/seats are filled/);
 assert.equal(Number((await admin.query('SELECT count(*) FROM "'+schema+'".participants WHERE competition_id=$1',[comp])).rows[0].count),10);
 assert.equal(Number((await admin.query('SELECT count(*) FROM "'+schema+'".token_accounts')).rows[0].count),10);
 const index=outcomes.findIndex(o=>o.status==='fulfilled'),winning=outcomes[index] as PromiseFulfilledResult<any>;
 assert.equal((await battle.enroll(comp,candidates[index],{rulesVersionId:rules})).participantId,winning.value.participantId);
 assert.equal(Number((await admin.query('SELECT count(*) FROM "'+schema+'".token_accounts')).rows[0].count),10);
});
test('migration installs immutable guards despite equal trigger names in another schema',async()=>{
 const collision='trigger_collision_'+randomUUID().replace(/-/g,'');
 await admin.query('CREATE SCHEMA "'+collision+'"');
 try{
  await admin.query('CREATE TABLE "'+collision+'".competition_rules_versions(id uuid PRIMARY KEY)');
  await admin.query('CREATE TRIGGER competition_rules_versions_immutable BEFORE UPDATE OR DELETE ON "'+collision+'".competition_rules_versions FOR EACH ROW EXECUTE FUNCTION battle.reject_immutable_change()');
  const sql=readFileSync(resolve(__dirname,'../db/migrations/001_initial.sql'),'utf8');
  const block=sql.slice(sql.lastIndexOf('DO $$ DECLARE t text; BEGIN'),sql.lastIndexOf('COMMIT;')).replace("'battle.%I'","'"+schema+".%I'");
  await admin.query('SET search_path TO "'+schema+'",battle;'+block);
  const guard=(await admin.query("SELECT count(*) FROM pg_trigger WHERE tgname='competition_rules_versions_immutable' AND tgrelid=$1::regclass",[schema+'.competition_rules_versions'])).rows[0];assert.equal(Number(guard.count),1);
  await assert.rejects(admin.query('UPDATE "'+schema+'".competition_rules_versions SET digest=\'tampered\' WHERE id=$1',[rules]),/Immutable record/);
  await assert.rejects(admin.query('UPDATE "'+schema+'".attempts SET prompt=\'tampered\' WHERE competition_id=$1',[comp]),/Immutable record/);
 }finally{if(!/^trigger_collision_[a-f0-9]{32}$/.test(collision))throw new Error('Unsafe cleanup');await admin.query('DROP SCHEMA "'+collision+'" CASCADE');}
});