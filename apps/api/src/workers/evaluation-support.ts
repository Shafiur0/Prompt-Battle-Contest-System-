import {randomUUID} from 'node:crypto';
import {OpenRouterError,type CompleteInput} from '@prompt-battle/openrouter';
import {pool,transaction,audit} from '../db';
import {config} from '../config';
import {digest,problemForManifest} from '../domain';
import {router,receipt,validUsage} from './generation';
import {archiveCallEvidence,claimEvaluation} from './evidence';export async function selected(selectionId:string){
 const row=(await pool.query('SELECT f.*,a.prompt,r.answer,c.problem,c.closure_epoch,m.manifest FROM final_selections f JOIN attempts a ON a.id=f.attempt_id JOIN responses r ON r.id=f.response_id JOIN competitions c ON c.id=f.competition_id JOIN competition_rules_versions m ON m.id=a.rules_version_id WHERE f.id=$1',[selectionId])).rows[0];
 if(!row)throw new Error('Selected case is unavailable.');
 row.problem=await problemForManifest(row.competition_id,row.manifest,row.problem);return row;
}
export async function run(row:any,purpose:string,input:unknown,parent:string|null=null){
 const id=randomUUID();
 return transaction(async db=>{
  if(!await claimEvaluation(db,row.id,purpose,id))return null;
  await db.query('INSERT INTO evaluation_runs(id,competition_id,selection_id,purpose,parent_run_id,closure_epoch,input,input_digest,model,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,\'RUNNING\')',[id,row.competition_id,row.id,purpose,parent,purpose==='QUALITY'?null:row.closure_epoch,JSON.stringify(input),digest(input),purpose==='QUALITY'?row.manifest.qualityModel:row.manifest.reviewerModel]);
  return id;
 });
}
export async function invoke(runId:string,row:any,purpose:'QUALITY'|'REVIEWER',request:{messages:any[];schema:object;maxTokens:number}){
 if(!config.apiKey)throw new Error('MODEL_CONFIGURATION_PENDING');
 const callId=randomUUID(),model=purpose==='QUALITY'?row.manifest.qualityModel:row.manifest.reviewerModel;
 const input:CompleteInput={model,provider:row.manifest.reviewProvider,messages:request.messages,maxOutputTokens:request.maxTokens,jsonSchema:request.schema,requestId:callId};
 await pool.query('INSERT INTO provider_calls(id,purpose,evaluation_run_id,request_digest,model,provider,request_id,status,dispatched_at) VALUES($1::uuid,$2,$3,$4,$5,$6,$7::text,\'DISPATCHING\',clock_timestamp())',[callId,purpose,runId,digest(input),model,row.manifest.reviewProvider,callId]);
 await pool.query('UPDATE provider_calls SET request_digest_version=\'sha256-json-c14n-v1\' WHERE id=$1',[callId]);
 await pool.query('UPDATE evaluation_runs SET heartbeat_at=clock_timestamp() WHERE id=$1',[runId]);
 await pool.query('INSERT INTO provider_call_events(provider_call_id,kind,raw_evidence,evidence_digest) VALUES($1,\'REQUEST\',$2,$3) ON CONFLICT DO NOTHING',[callId,JSON.stringify(input),digest(input)]);
 try{
  const result=await router.complete(input);
  await transaction(async db=>{
   await archiveCallEvidence(db,callId,'RESPONSE',result.rawReceipt);
   if(validUsage(result.usage))await receipt(db,callId,result.usage,result.rawReceipt);
   await db.query('UPDATE provider_calls SET status=$2,provider_generation_id=$3,completed_at=clock_timestamp() WHERE id=$1',[callId,result.usage?'SETTLED':'USAGE_PENDING',result.id]);
   await audit(db,row.competition_id,null,'ORGANIZER_MODEL_CALL_COMPLETED',{callId,runId,purpose,model,usageKnown:validUsage(result.usage)});
  });
  if(result.model!==model)throw new Error('FROZEN_MODEL_MISMATCH');
  return result.content;
 }catch(error){
  const code=error instanceof OpenRouterError?error.code:error instanceof Error?error.message:'MODEL_CALL_FAILED';
  await transaction(async db=>{
   const rawEvidence=error instanceof OpenRouterError?error.rawReceipt||{errorCode:code}:{errorCode:code};
   await archiveCallEvidence(db,callId,'ERROR',rawEvidence);
   if(error instanceof OpenRouterError&&validUsage(error.usage))await receipt(db,callId,error.usage,rawEvidence);
   await db.query('UPDATE provider_calls SET status=\'FAILED\',failure_reason=$2,provider_generation_id=COALESCE($3,provider_generation_id) WHERE id=$1',[callId,code,error instanceof OpenRouterError?error.generationId||null:null]);
   await audit(db,row.competition_id,null,'ORGANIZER_MODEL_CALL_FAILED',{callId,runId,purpose,errorCode:code,unknownOutcome:error instanceof OpenRouterError&&error.classification==='AMBIGUOUS'});
  });
  throw new Error(code);
 }
}
