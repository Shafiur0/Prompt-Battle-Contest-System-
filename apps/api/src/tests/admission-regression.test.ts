import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { Pool } from 'pg';
import { SAMPLE_PROBLEM,SAMPLE_OPTIMAL_ANSWER } from '@prompt-battle/core';
// Admission-only fixtures: no private .env, HTTP auth bypass or model client is used.
process.env.NODE_ENV='test';
process.env.OPENROUTER_API_KEY='test-fixture-no-provider';
process.env.OFFICIAL_PROVIDER_QUALIFIED='false';
const schema='admission_regression_'+randomUUID().replace(/-/g,'');
if(!/^admission_regression_[a-f0-9]{32}$/.test(schema))throw new Error('Unsafe test schema');
const dbUrl=process.env.TEST_DATABASE_URL||'postgresql://prompt_battle:local-development-only@localhost:5432/prompt_battle';
const admin=new Pool({connectionString:dbUrl});
const userId=randomUUID(),participantId=randomUUID(),competitionId=randomUUID(),ruleId=randomUUID();
let appPool:any,battle:any;
before(async()=>{
 const dbModule=await import('../db');
 appPool=dbModule.pool;
 Object.assign(appPool.options,{connectionString:dbUrl,options:'-c search_path='+schema});
 await admin.query('CREATE SCHEMA "'+schema+'"');
 const tables=['users','competitions','problem_versions','solving_timings','competition_rules_versions','participants','token_accounts','attempts','attempt_states','provider_calls','token_ledger_events','outbox_jobs','idempotency_records','audit_heads','audit_events','responses','provider_usage_receipts','provider_call_events','final_selections','submission_states','registry_versions','evaluation_runs','evaluation_claims','quality_evaluations','quality_human_reviews','closure_proofs','integrity_detections','integrity_reports','policy_reviews','appeals','token_snapshots','score_revisions'];
 for(const table of tables)await admin.query('CREATE TABLE "'+schema+'"."'+table+'" (LIKE battle."'+table+'" INCLUDING ALL)');
 await admin.query('CREATE FUNCTION "'+schema+'".append_audit(c uuid,a uuid,k text,p jsonb) RETURNS void LANGUAGE sql AS $$ SELECT battle.append_audit(c,a,k,p) $$');
 await admin.query('INSERT INTO "'+schema+'".users(id,issuer,subject,alias) VALUES($1,\'fixture-issuer\',\'fixture-subject\',\'fixture-participant\')',[userId]);
 await admin.query('INSERT INTO "'+schema+'".competitions(id,title,status,problem,rules_version_id,generation_cutoff,selection_cutoff,calibration) VALUES($1,\'Isolated admission fixture\',\'GENERATION_OPEN\',\'{}\',$2,clock_timestamp()+interval \'1 hour\',clock_timestamp()+interval \'2 hours\',true)',[competitionId,ruleId]);
 const manifest={generationModel:'test-fixture-model',generationProvider:'test-fixture-provider',qualityModel:'test-fixture-quality',reviewerModel:'test-fixture-reviewer',reviewProvider:'test-fixture-provider',inputUpperBound:1024,maxOutputTokens:128,maxPromptBytes:64000,systemEnvelope:'Fixture envelope only'};
 await admin.query('INSERT INTO "'+schema+'".competition_rules_versions(id,competition_id,sequence,manifest,digest) VALUES($1,$2,1,$3,$4)',[ruleId,competitionId,JSON.stringify(manifest),createHash('sha256').update(JSON.stringify(manifest)).digest('hex')]);
 await admin.query('INSERT INTO "'+schema+'".participants(id,competition_id,user_id) VALUES($1,$2,$3)',[participantId,competitionId,userId]);
 await admin.query('INSERT INTO "'+schema+'".token_accounts(participant_id) VALUES($1)',[participantId]);
 const registryId=randomUUID();
 await admin.query('INSERT INTO "'+schema+'".registry_versions(id,competition_id,sequence,registry,digest) VALUES($1,$2,1,$3,$4)',[registryId,competitionId,JSON.stringify(SAMPLE_PROBLEM.registry),createHash('sha256').update(JSON.stringify(SAMPLE_PROBLEM.registry)).digest('hex')]);
 await admin.query('UPDATE "'+schema+'".competitions SET problem=$2,registry_version_id=$3 WHERE id=$1',[competitionId,JSON.stringify(SAMPLE_PROBLEM),registryId]);
 battle=new (await import('../service')).BattleService();
});
after(async()=>{
 await appPool?.end();
 if(!/^admission_regression_[a-f0-9]{32}$/.test(schema))throw new Error('Refusing unsafe cleanup');
 await admin.query('DROP SCHEMA "'+schema+'" CASCADE');
 await admin.end();
});
test('actual BattleService.createAttempt admits once with UUID id and text request id, without a model call',async()=>{
 const actor={id:userId,alias:'fixture-participant',isOrganizer:false},body={prompt:'Synthetic admission fixture only; return the documented allocation JSON.'},key=randomUUID();
 const result=await battle.createAttempt(competitionId,actor,body,key);
 assert.equal(result.status,'QUEUED');assert.equal(result.reservedTokens,1152);
 const call=(await admin.query('SELECT id,request_id,status FROM "'+schema+'".provider_calls')).rows[0];
 assert.equal(call.request_id,call.id);assert.equal(call.status,'QUEUED');
 const account=(await admin.query('SELECT consumed,reserved FROM "'+schema+'".token_accounts')).rows[0];
 assert.equal(Number(account.consumed),0);assert.equal(Number(account.reserved),1152);
 assert.equal(Number((await admin.query('SELECT count(*) FROM "'+schema+'".outbox_jobs')).rows[0].count),1);
 const replay=await battle.createAttempt(competitionId,actor,body,key);
 assert.equal(replay.attemptId,result.attemptId);
 assert.equal(Number((await admin.query('SELECT count(*) FROM "'+schema+'".attempts')).rows[0].count),1);
 assert.equal(Number((await admin.query('SELECT reserved FROM "'+schema+'".token_accounts')).rows[0].reserved),1152);
});
test('actual admission rejects another unsettled request without altering the held budget',async()=>{
 await assert.rejects(battle.createAttempt(competitionId,{id:userId,alias:'fixture-participant',isOrganizer:false},{prompt:'Second synthetic fixture.'},randomUUID()),/existing provider request/);
 assert.equal(Number((await admin.query('SELECT count(*) FROM "'+schema+'".provider_calls')).rows[0].count),1);
 assert.equal(Number((await admin.query('SELECT reserved FROM "'+schema+'".token_accounts')).rows[0].reserved),1152);
});

test('actual generation dispatch and settlement persist one immutable answer and real reported usage once',async()=>{
 const worker=await import('../workers/generation');
 const call=(await admin.query('SELECT id FROM "'+schema+'".provider_calls')).rows[0];
 let mockedCalls=0;
 worker.router.complete=async(input:any)=>{
  mockedCalls++;
  return {id:'test-only-generation-id',model:input.model,content:JSON.stringify(SAMPLE_OPTIMAL_ANSWER),usage:{inputTokens:100,outputTokens:50,totalTokens:150},rawReceipt:{id:'test-only-generation-id',usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150}},clientRequestId:input.requestId};
 };
 await worker.generate(call.id);
 await worker.generate(call.id);
 assert.equal(mockedCalls,1);
 const account=(await admin.query('SELECT consumed,reserved FROM "'+schema+'".token_accounts')).rows[0];
 assert.equal(Number(account.consumed),150);assert.equal(Number(account.reserved),0);
 assert.equal(Number((await admin.query('SELECT count(*) FROM "'+schema+'".responses')).rows[0].count),1);
 const receipt=(await admin.query('SELECT input_tokens,output_tokens,total_tokens FROM "'+schema+'".provider_usage_receipts')).rows[0];
 assert.equal(Number(receipt.input_tokens),100);assert.equal(Number(receipt.output_tokens),50);assert.equal(Number(receipt.total_tokens),150);
 assert.equal(Number((await admin.query('SELECT count(*) FROM "'+schema+'".token_ledger_events WHERE kind=\'SETTLE\'')).rows[0].count),1);
});
test('actual final selection and paired quality-judge inserts use UUID ids and text request ids safely',async()=>{
 const attempt=(await admin.query('SELECT id FROM "'+schema+'".attempts')).rows[0];
 const selected=await battle.select(competitionId,{id:userId,alias:'fixture-participant',isOrganizer:false},{attemptId:attempt.id},randomUUID());
 assert.ok(selected.submissionId);
 const selection=(await admin.query('SELECT id FROM "'+schema+'".final_selections')).rows[0];
 const worker=await import('../workers/generation'),evaluation=await import('../workers/evaluation');
 let mockJudges=0;
 worker.router.complete=async(input:any)=>{
  assert.equal(input.model,'test-fixture-quality');mockJudges++;
  const rationale=SAMPLE_OPTIMAL_ANSWER.rationale;
  const content=JSON.stringify({verdict:'VALID',scores:{clarity:3,justification:3,conciseness:3},evidence:[{criterion:'clarity',quote:rationale},{criterion:'justification',quote:rationale},{criterion:'conciseness',quote:rationale}],reasoning_summary:'Isolated fixture judgment; no real model used.'});
  return {id:'test-only-judge-'+mockJudges,model:input.model,content,usage:{inputTokens:10,outputTokens:20,totalTokens:30},rawReceipt:{id:'test-only-judge-'+mockJudges,usage:{prompt_tokens:10,completion_tokens:20,total_tokens:30}},clientRequestId:input.requestId};
 };
 await evaluation.evaluateQuality(selection.id);
 assert.equal(mockJudges,2);
 const calls=(await admin.query('SELECT id,request_id FROM "'+schema+'".provider_calls WHERE purpose=\'QUALITY\'')).rows;
 assert.equal(calls.length,2);for(const call of calls)assert.equal(call.id,call.request_id);
 const quality=(await admin.query('SELECT j,needs_human_review FROM "'+schema+'".quality_evaluations')).rows[0];
 assert.ok(Math.abs(Number(quality.j)-0.75)<1e-12);assert.equal(quality.needs_human_review,false);
 assert.equal(Number((await admin.query('SELECT consumed FROM "'+schema+'".token_accounts')).rows[0].consumed),150);
});

test('an inconclusive appeal stays OPEN and hides the old score until a final successor resolves it',async()=>{
 const owner={id:randomUUID(),alias:'fixture-owner',isOrganizer:true};
 await admin.query('INSERT INTO "'+schema+'".users(id,issuer,subject,alias,is_organizer) VALUES($1,\'fixture\',\'fixture-owner\',\'fixture-owner\',true)',[owner.id]);
 await admin.query('UPDATE "'+schema+'".competitions SET organizer_id=$2 WHERE id=$1',[competitionId,owner.id]);
 const organizer=new (await import('../organizer')).OrganizerService(),worker=await import('../workers/generation'),evaluation=await import('../workers/evaluation'),finalizer=await import('../workers/finalization');
 const selection=(await admin.query('SELECT id FROM "'+schema+'".final_selections')).rows[0],workflow=(await admin.query('SELECT id FROM "'+schema+'".submission_states')).rows[0];
 const closure=await organizer.close(competitionId,owner);
 worker.router.complete=async(input:any)=>({id:'fixture-integrity-id',model:input.model,content:JSON.stringify({verdict:'NO_VIOLATION',confidence:null,allowed_information_matches:[],original_contribution_summary:'Synthetic fixture only.',evidence:[],reasoning_summary:'No protected passages in fixture.',recommended_penalty:'NONE'}),usage:{inputTokens:10,outputTokens:10,totalTokens:20},rawReceipt:{usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}},clientRequestId:input.requestId});
 await evaluation.evaluateIntegrity(selection.id,closure.closureEpoch);
 await organizer.decision(workflow.id,owner,{verdict:'NO_VIOLATION',reason:'Initial human fixture clearance.',severity:'NONE'},randomUUID());
 await finalizer.finalize(selection.id);await organizer.reveal(competitionId,owner);
 assert.ok((await battle.submission(workflow.id,{id:userId,alias:'fixture-participant',isOrganizer:false})).score);
 const appeal=await battle.appeal(workflow.id,{id:userId,alias:'fixture-participant',isOrganizer:false},'Synthetic fixture appeal.',randomUUID());
 await organizer.decision(workflow.id,owner,{verdict:'INSUFFICIENT_EVIDENCE',reason:'Further human evidence is needed.',severity:'NONE',appealId:appeal.appealId},randomUUID());
 await finalizer.finalize(selection.id);
 assert.equal((await admin.query('SELECT status FROM "'+schema+'".appeals WHERE id=$1',[appeal.appealId])).rows[0].status,'OPEN');
 const pending=await battle.submission(workflow.id,{id:userId,alias:'fixture-participant',isOrganizer:false});assert.equal(pending.score,null);assert.equal(pending.integrityNotice,null);
 assert.equal((await battle.leaderboard(competitionId)).rows[0].score,null);
 await organizer.decision(workflow.id,owner,{verdict:'NO_VIOLATION',reason:'Final human fixture appeal resolution.',severity:'NONE',appealId:appeal.appealId},randomUUID());
 await finalizer.finalize(selection.id);
 assert.equal((await admin.query('SELECT status FROM "'+schema+'".appeals WHERE id=$1',[appeal.appealId])).rows[0].status,'RESOLVED');
 assert.ok((await battle.submission(workflow.id,{id:userId,alias:'fixture-participant',isOrganizer:false})).score);
 assert.equal(Number((await admin.query('SELECT count(*) FROM "'+schema+'".policy_reviews')).rows[0].count),3);
});

test('post-closure human fallback exposes retained detection without a fabricated machine report',async()=>{
 const row=(await admin.query('SELECT organizer_id,closure_epoch FROM "'+schema+'".competitions WHERE id=$1',[competitionId])).rows[0];
 const owner={id:row.organizer_id,alias:'fixture-owner',isOrganizer:true},organizer=new (await import('../organizer')).OrganizerService();
 await admin.query('DELETE FROM "'+schema+'".integrity_reports');
 await admin.query('UPDATE "'+schema+'".evaluation_runs SET status=\'FAILED\',failure_reason=\'INVALID_REVIEWER_SCHEMA_OR_EVIDENCE\' WHERE purpose=\'CRITICAL_CONTEXT_REVIEW\'');
 const closed=await organizer.dashboard(competitionId,owner);
 assert.equal(closed.cases[0].review,null);assert.equal(closed.cases[0].humanFallbackAvailable,true);assert.equal(closed.cases[0].evidenceReady,true);
 assert.deepEqual(closed.cases[0].copyEvidence,[]);assert.equal(closed.cases[0].contextualFailure,'INVALID_REVIEWER_SCHEMA_OR_EVIDENCE');
 await admin.query('UPDATE "'+schema+'".competitions SET closure_epoch=NULL WHERE id=$1',[competitionId]);
 assert.deepEqual((await organizer.dashboard(competitionId,owner)).cases,[]);
 await admin.query('UPDATE "'+schema+'".competitions SET closure_epoch=$2 WHERE id=$1',[competitionId,row.closure_epoch]);
});