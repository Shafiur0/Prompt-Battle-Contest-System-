import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { Pool } from 'pg';
import { reserveAccount } from '../budget';
import { archiveCallEvidence,claimEvaluation } from '../workers/evidence';
import { normalizeCompletionUsage } from '@prompt-battle/openrouter';
const schema='api_regression_'+randomUUID().replace(/-/g,'');
if(!/^api_regression_[a-f0-9]{32}$/.test(schema))throw new Error('Invalid isolated test schema');
const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL||'postgresql://prompt_battle:local-development-only@localhost:5432/prompt_battle',max:5});
const accountId=randomUUID(),callId=randomUUID();
before(async()=>{
 await pool.query('CREATE SCHEMA "'+schema+'"');
 await pool.query('CREATE TABLE "'+schema+'".token_accounts(participant_id uuid PRIMARY KEY,allowance bigint NOT NULL,consumed bigint NOT NULL,reserved bigint NOT NULL,state text NOT NULL,CHECK(consumed+reserved<=allowance))');
 await pool.query('INSERT INTO "'+schema+'".token_accounts VALUES($1,2000000,1999000,0,\'OPEN\')',[accountId]);
 await pool.query('CREATE TABLE "'+schema+'".evaluation_claims(selection_id uuid,purpose text,revision integer,run_id uuid,PRIMARY KEY(selection_id,purpose,revision))');
 await pool.query('CREATE TABLE "'+schema+'".provider_call_events(id uuid DEFAULT gen_random_uuid(),provider_call_id uuid,kind text,raw_evidence jsonb,evidence_digest text,UNIQUE(provider_call_id,kind,evidence_digest))');
 await pool.query('CREATE TABLE "'+schema+'".provider_usage_receipts(provider_call_id uuid,input_tokens bigint,output_tokens bigint)');
 await pool.query('CREATE TABLE "'+schema+'".audit_heads(competition_id uuid PRIMARY KEY,sequence bigint NOT NULL DEFAULT 0,digest text NOT NULL DEFAULT \'\')');
 await pool.query('CREATE TABLE "'+schema+'".audit_events(id uuid DEFAULT gen_random_uuid(),competition_id uuid,actor_id uuid,sequence bigint,kind text,payload jsonb,previous_digest text,digest text,created_at timestamptz DEFAULT clock_timestamp())');
 await pool.query('CREATE TRIGGER test_events_immutable BEFORE UPDATE OR DELETE ON "'+schema+'".provider_call_events FOR EACH ROW EXECUTE FUNCTION battle.reject_immutable_change()');
});
after(async()=>{
 if(!/^api_regression_[a-f0-9]{32}$/.test(schema))throw new Error('Refusing unsafe test cleanup');
 await pool.query('DROP SCHEMA "'+schema+'" CASCADE');
 await pool.end();
});
async function withTransaction<T>(action:(db:any)=>Promise<T>):Promise<T>{
 const db=await pool.connect();try{await db.query('BEGIN');await db.query('SET LOCAL search_path TO "'+schema+'"');const result=await action(db);await db.query('COMMIT');return result;}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
test('real PostgreSQL serializes concurrent budget reservations at the allowance edge',async()=>{
 const operations=[1,2].map(()=>withTransaction(async db=>{const result=await reserveAccount(db,accountId,800);if(result)await new Promise(r=>setTimeout(r,50));return !!result;}));
 const results=await Promise.all(operations);assert.equal(results.filter(Boolean).length,1);
 const row=(await pool.query('SELECT * FROM "'+schema+'".token_accounts WHERE participant_id=$1',[accountId])).rows[0];
 assert.equal(Number(row.reserved),800);assert.equal(Number(row.consumed)+Number(row.reserved),1999800);
});
test('real PostgreSQL evaluation claim permits one logical remote sequence under concurrency',async()=>{
 const selection=randomUUID();let simulatedRemoteSequences=0;
 const results=await Promise.all([1,2,3].map(()=>withTransaction(async db=>{const claimed=await claimEvaluation(db,selection,'QUALITY',randomUUID());if(claimed)simulatedRemoteSequences++;return claimed;})));
 assert.equal(results.filter(Boolean).length,1);assert.equal(simulatedRemoteSequences,1);
 assert.equal(Number((await pool.query('SELECT count(*) FROM "'+schema+'".evaluation_claims')).rows[0].count),1);
});
test('missing-usage provider evidence is retained without zero-token fabrication or releasing holds',async()=>{
 const raw={id:'test-only-provider-id',model:'test-only-model',choices:[{message:{content:'test fixture'}}]};
 assert.equal(normalizeCompletionUsage(raw),undefined);
 await withTransaction(async db=>{await archiveCallEvidence(db,callId,'RESPONSE',raw);await archiveCallEvidence(db,callId,'RESPONSE',raw);});
 const rows=(await pool.query('SELECT raw_evidence FROM "'+schema+'".provider_call_events')).rows;assert.equal(rows.length,1);assert.deepEqual(rows[0].raw_evidence,raw);
 assert.equal(Number((await pool.query('SELECT count(*) FROM "'+schema+'".provider_usage_receipts')).rows[0].count),0);
 assert.equal(Number((await pool.query('SELECT reserved FROM "'+schema+'".token_accounts')).rows[0].reserved),800);
});
test('real immutable-evidence trigger rejects historical updates',async()=>{
 await assert.rejects(pool.query('UPDATE "'+schema+'".provider_call_events SET raw_evidence=\'{}\' WHERE provider_call_id=$1',[callId]),/Immutable record cannot be changed/);
 assert.notDeepEqual((await pool.query('SELECT raw_evidence FROM "'+schema+'".provider_call_events')).rows[0].raw_evidence,{});
});

test('real audit helper appends a SHA-256 chain without relying on pgcrypto schema placement',async()=>{
 const competitionId=randomUUID();
 await withTransaction(async db=>{
  await db.query('SELECT battle.append_audit($1,NULL,$2,$3::jsonb)',[competitionId,'TEST_AUDIT_FIRST',JSON.stringify({z:1,a:'Dhaka • UTF-8'})]);
  await db.query('SELECT battle.append_audit($1,NULL,$2,$3::jsonb)',[competitionId,'TEST_AUDIT_SECOND',JSON.stringify({updated:true})]);
 });
 const events=(await pool.query('SELECT sequence,kind,payload::text AS payload_text,previous_digest,digest FROM "'+schema+'".audit_events WHERE competition_id=$1 ORDER BY sequence',[competitionId])).rows;
 assert.equal(events.length,2);
 let previous='';
 for(const event of events){
  assert.equal(event.previous_digest,previous);
  const expected=createHash('sha256').update(previous+event.kind+event.payload_text,'utf8').digest('hex');
  assert.equal(event.digest,expected);previous=event.digest;
 }
 const head=(await pool.query('SELECT sequence,digest FROM "'+schema+'".audit_heads WHERE competition_id=$1',[competitionId])).rows[0];
 assert.equal(Number(head.sequence),2);assert.equal(head.digest,previous);
});
