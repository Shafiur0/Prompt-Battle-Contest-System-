import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { Pool } from 'pg';
import { SAMPLE_PROBLEM,type StructuredProblemDraft } from '@prompt-battle/core';
process.env.NODE_ENV='test';process.env.OPENROUTER_API_KEY='test-fixture-no-provider';process.env.OFFICIAL_PROVIDER_QUALIFIED='false';
const schema='problem_regression_'+randomUUID().replace(/-/g,'');
const url=process.env.TEST_DATABASE_URL||'postgresql://prompt_battle:local-development-only@localhost:5432/prompt_battle';
const admin=new Pool({connectionString:url});
const teacher={id:randomUUID(),alias:'fixture-teacher',isOrganizer:true},other={id:randomUUID(),alias:'other-teacher',isOrganizer:true},learner={id:randomUUID(),alias:'fixture-learner',isOrganizer:false};
const id=randomUUID(),regId=randomUUID(),rulesId=randomUUID(),participantId=randomUUID();
let appPool:any,editor:any,battle:any;
const draft:StructuredProblemDraft={
 kind:'STRUCTURED_JSON',title:'Square a number',statement:'Given n=4, calculate its square. Provide a brief explanation.',
 objectives:['Return a correct calculation.'],constraints:['Return only the published JSON structure.'],
 requirements:[{id:'correct-result',text:'result must be the square of the given n, and must not be negative.',group:'C'},{id:'brief-reason',text:'rationale must contain a nonempty explanation.',group:'K'}],
 outputSchema:{type:'object',properties:{result:{type:'integer',minimum:0,maximum:100},rationale:{type:'string',minLength:1,maxLength:200}},required:['result','rationale'],additionalProperties:false},
 checks:[{id:'public-positive',name:'Nonnegative result',requirementId:'correct-result',path:'/result',operator:'gte',expected:0,weight:1,essential:true,visibility:'public'},{id:'private-correct',name:'Calculated result',requirementId:'correct-result',path:'/result',operator:'equals',expected:16,weight:1,essential:true,visibility:'private'},{id:'explanation',name:'Explanation exists',requirementId:'brief-reason',path:'/rationale',operator:'exists',weight:1,essential:true,visibility:'private'}],
 referenceAnswer:{result:16,rationale:'Four multiplied by four is sixteen.'}
};
before(async()=>{
 const db=await import('../db');appPool=db.pool;Object.assign(appPool.options,{connectionString:url,options:'-c search_path='+schema});
 await admin.query('CREATE SCHEMA "'+schema+'"');
 const tables=(await admin.query("SELECT table_name FROM information_schema.tables WHERE table_schema='battle' AND table_type='BASE TABLE'")).rows;
 for(const row of tables){if(!/^[a-z_]+$/.test(row.table_name))throw new Error('Unsafe fixture table');await admin.query('CREATE TABLE "'+schema+'"."'+row.table_name+'" (LIKE battle."'+row.table_name+'" INCLUDING ALL)');}
 await admin.query('CREATE FUNCTION "'+schema+'".append_audit(c uuid,a uuid,k text,p jsonb) RETURNS void LANGUAGE sql AS $$ SELECT battle.append_audit(c,a,k,p) $$');
 await admin.query('CREATE TRIGGER fixture_problem_guard BEFORE UPDATE OF problem ON "'+schema+'".competitions FOR EACH ROW EXECUTE FUNCTION battle.guard_published_problem()');
 for(const u of [teacher,other,learner])await admin.query('INSERT INTO "'+schema+'".users(id,issuer,subject,alias,is_organizer) VALUES($1,\'fixture\',$2,$2,$3)',[u.id,u.alias,u.isOrganizer]);
 const problem={...structuredClone(SAMPLE_PROBLEM),versionId:'legacy-allocation-version'};
 await admin.query('INSERT INTO "'+schema+'".competitions(id,title,problem,rules_version_id,registry_version_id,organizer_id,generation_cutoff,selection_cutoff) VALUES($1,\'Fixture round\',$2,$3,$4,$5,clock_timestamp()+interval \'1 hour\',clock_timestamp()+interval \'2 hours\')',[id,JSON.stringify(problem),rulesId,regId,teacher.id]);
 await admin.query('INSERT INTO "'+schema+'".registry_versions(id,competition_id,sequence,registry,digest) VALUES($1,$2,1,$3,\'fixture-digest\')',[regId,id,JSON.stringify(problem.registry)]);
 const manifest={generationModel:'fixture-generator',qualityModel:'fixture-quality',reviewerModel:'fixture-reviewer',generationProvider:'fixture-provider',reviewProvider:'fixture-provider',inputUpperBound:1024,maxOutputTokens:128,maxPromptBytes:64000,systemEnvelope:'Fixture envelope'};
 await admin.query('INSERT INTO "'+schema+'".competition_rules_versions(id,competition_id,sequence,manifest,digest) VALUES($1,$2,1,$3,\'fixture-digest\')',[rulesId,id,JSON.stringify(manifest)]);
 await admin.query('INSERT INTO "'+schema+'".problem_versions(id,competition_id,version_id,sequence,content,digest) VALUES($1,$2,$3,1,$4,\'fixture-digest\')',[randomUUID(),id,problem.versionId,JSON.stringify(problem)]);
 editor=new (await import('../problem-editor')).ProblemEditorService();battle=new (await import('../service')).BattleService();
});
after(async()=>{await appPool?.end();if(!/^problem_regression_[a-f0-9]{32}$/.test(schema))throw new Error('Unsafe cleanup');await admin.query('DROP SCHEMA "'+schema+'" CASCADE');await admin.end();});
test('private problem draft GET is owner-only and preserves legacy public version ids',async()=>{
 const view=await editor.get(id,teacher);assert.equal(view.problemKind,'ALLOCATION');assert.equal(view.versionId,'legacy-allocation-version');assert.equal(view.draft,null);
 await assert.rejects(editor.get(id,other),/another organizer/);await assert.rejects(editor.save(id,learner,draft),/another organizer/);
});
test('invalid reference answers and unknown requirement links reject before any mutation',async()=>{
 const bad=structuredClone(draft);bad.referenceAnswer={result:17,rationale:'Wrong fixture.'};
 await assert.rejects(editor.save(id,teacher,bad));
 const unknown=structuredClone(draft);unknown.checks[0].requirementId='unknown';
 await assert.rejects(editor.save(id,teacher,unknown));
 assert.equal(Number((await admin.query('SELECT count(*) FROM "'+schema+'".problem_versions')).rows[0].count),1);
});
test('a vanished protected quote blocks problem replacement until explicit draft registry correction',async()=>{
 const row=(await admin.query('SELECT registry FROM "'+schema+'".registry_versions WHERE id=$1',[regId])).rows[0].registry;
 const quote='Generated answers cannot be edited.',index=row.sourceText.indexOf(quote),start=Buffer.byteLength(row.sourceText.slice(0,index),'utf8');
 row.items.push({id:randomUUID(),category:'PROTECTED_CRITICAL_INFORMATION',text:quote,sourceStartByte:start,sourceEndByte:start+Buffer.byteLength(quote),publicRuleId:'OLD-PASSAGE',severity:'MATERIAL'});
 await admin.query('UPDATE "'+schema+'".registry_versions SET registry=$2 WHERE id=$1',[regId,JSON.stringify(row)]);
 await assert.rejects(editor.save(id,teacher,draft),/protected source quote would disappear/);
 row.items=row.items.filter((i:any)=>i.publicRuleId!=='OLD-PASSAGE');await admin.query('UPDATE "'+schema+'".registry_versions SET registry=$2 WHERE id=$1',[regId,JSON.stringify(row)]);
});
test('valid custom save creates immutable scoped snapshots and fresh requirement registry',async()=>{
 const result=await editor.save(id,teacher,draft);assert.equal(result.problemKind,'STRUCTURED_JSON');assert.equal(result.draft.statement,draft.statement);assert.deepEqual(result.draft.referenceAnswer,draft.referenceAnswer);
 assert.notEqual(result.versionId,'legacy-allocation-version');
 const versions=(await admin.query('SELECT version_id,sequence FROM "'+schema+'".problem_versions ORDER BY sequence')).rows;assert.equal(versions.length,2);assert.equal(versions[0].version_id,'legacy-allocation-version');
 const current=(await admin.query('SELECT c.problem,r.registry FROM "'+schema+'".competitions c JOIN "'+schema+'".registry_versions r ON r.id=c.registry_version_id WHERE c.id=$1',[id])).rows[0];
 const currentRules=(await admin.query('SELECT r.manifest FROM "'+schema+'".competitions c JOIN "'+schema+'".competition_rules_versions r ON r.id=c.rules_version_id WHERE c.id=$1',[id])).rows[0].manifest;
 assert.equal(currentRules.problemRevision,2);assert.equal(currentRules.reviewMode,'AUTOMATIC_REVIEWER');assert.equal(currentRules.rankingMode,'EARLIEST_CORRECT_TIEBREAK_V1');
 const packageConfig=await import('../config');assert.equal(currentRules.reviewPackage,packageConfig.REVIEW_PACKAGE);assert.equal(currentRules.reviewPackageDigest,packageConfig.REVIEW_PACKAGE_DIGEST);assert.equal(currentRules.providerQualified,false);assert.equal(currentRules.qualificationEvidence,null);
 assert.equal(current.problem.kind,'STRUCTURED_JSON');assert.equal(current.registry.sourceText,current.problem.statement);assert.ok(!current.registry.items.some((i:any)=>i.text==='North'||i.privateReference==='allocation-final-checks:v1'));
});
test('published custom edits append revisions and public DTO keeps private checks and reference hidden',async()=>{
 await admin.query('UPDATE "'+schema+'".competitions SET status=\'GENERATION_OPEN\' WHERE id=$1',[id]);
 const previous=(await admin.query('SELECT problem FROM \"'+schema+'\".competitions WHERE id=$1',[id])).rows[0].problem;
 const edited=await editor.save(id,teacher,draft);assert.notEqual(edited.versionId,previous.versionId);
 const originals=(await admin.query('SELECT content FROM \"'+schema+'\".problem_versions WHERE competition_id=$1 AND version_id=$2',[id,previous.versionId])).rows;assert.deepEqual(originals[0].content,previous);
 await assert.rejects(admin.query('UPDATE "'+schema+'".competitions SET problem=\'{}\' WHERE id=$1',[id]),/Published problem versions are immutable/);
 const publicView=await battle.competition(id,null);assert.equal(publicView.problemKind,'STRUCTURED_JSON');assert.deepEqual(publicView.outputSchema,draft.outputSchema);
 const json=JSON.stringify(publicView);assert.ok(!json.includes('"referenceAnswer"'));assert.ok(!json.includes('"checks"'));assert.ok(!json.includes('private-correct'));
 await assert.rejects(editor.get(id,other),/another organizer/);
});
test('actual generic generation sends only public schema, settles usage, and uses generic public checks',async()=>{
 await admin.query('INSERT INTO "'+schema+'".participants(id,competition_id,user_id) VALUES($1,$2,$3)',[participantId,id,learner.id]);await admin.query('INSERT INTO "'+schema+'".token_accounts(participant_id) VALUES($1)',[participantId]);
 const admitted=await battle.createAttempt(id,learner,{prompt:'Synthetic fixture only: solve the published square task with its JSON contract.'},randomUUID());
 const call=(await admin.query('SELECT id FROM "'+schema+'".provider_calls WHERE attempt_id=$1',[admitted.attemptId])).rows[0];
 const worker=await import('../workers/generation');let calls=0;
 worker.router.complete=async(input:any)=>{calls++;assert.deepEqual(input.jsonSchema,draft.outputSchema);const json=JSON.stringify(input);assert.ok(!json.includes('referenceAnswer'));assert.ok(!json.includes('private-correct'));return {id:'fixture-generic-generation',model:input.model,content:JSON.stringify(draft.referenceAnswer),usage:{inputTokens:30,outputTokens:20,totalTokens:50},rawReceipt:{usage:{prompt_tokens:30,completion_tokens:20,total_tokens:50}},clientRequestId:input.requestId};};
 await worker.generate(call.id);assert.equal(calls,1);
 const view=await battle.attempt(admitted.attemptId,learner);assert.equal(view.answer,JSON.stringify(draft.referenceAnswer));assert.ok(view.publicTests.length>0);assert.ok(view.publicTests.every((t:any)=>t.name!=='Calculated result'));assert.equal(view.totalTokens,50);
 const account=(await admin.query('SELECT consumed,reserved FROM "'+schema+'".token_accounts WHERE participant_id=$1',[participantId])).rows[0];assert.equal(Number(account.consumed),50);assert.equal(Number(account.reserved),0);
});
