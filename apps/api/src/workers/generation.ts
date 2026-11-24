import { OpenRouterClient,OpenRouterError,type CompletionResult,type TokenUsage } from '@prompt-battle/openrouter';
import { evaluateAnswer } from '@prompt-battle/core';
import { randomUUID } from 'node:crypto';
import { pool,transaction,audit,enqueue } from '../db';
import { config } from '../config';
import { digest,num,problemForManifest } from '../domain';
import { archiveCallEvidence } from './evidence';
export const router=new OpenRouterClient({apiKey:config.apiKey,baseUrl:config.routerUrl,timeoutMs:120000,siteUrl:config.origin});
export function validUsage(u:TokenUsage|undefined):u is TokenUsage{
 return !!u&&[u.inputTokens,u.outputTokens,u.totalTokens].every(n=>Number.isSafeInteger(n)&&n>=0)&&u.totalTokens===u.inputTokens+u.outputTokens;
}
export async function receipt(db:any,callId:string,usage:TokenUsage,raw:unknown){
 await db.query('INSERT INTO provider_usage_receipts(provider_call_id,input_tokens,output_tokens,total_tokens,raw_receipt,cost_usd,receipt_digest) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(provider_call_id) DO NOTHING',[callId,usage.inputTokens,usage.outputTokens,usage.totalTokens,JSON.stringify(raw),usage.costUsd??null,digest(raw)]);
}
async function finish(callId:string,result:CompletionResult|null,error:OpenRouterError|null){
 await transaction(async db=>{
  const scope=(await db.query('SELECT pc.*,a.participant_id,a.competition_id,a.prompt,c.problem,m.manifest FROM provider_calls pc JOIN attempts a ON a.id=pc.attempt_id JOIN competitions c ON c.id=a.competition_id JOIN competition_rules_versions m ON m.id=a.rules_version_id WHERE pc.id=$1',[callId])).rows[0];if(!scope)return;scope.problem=await problemForManifest(scope.competition_id,scope.manifest,scope.problem,db);
  await db.query('SELECT id FROM competitions WHERE id=$1 FOR SHARE',[scope.competition_id]);
  const account=(await db.query('SELECT * FROM token_accounts WHERE participant_id=$1 FOR UPDATE',[scope.participant_id])).rows[0];
  const call=(await db.query('SELECT * FROM provider_calls WHERE id=$1 FOR UPDATE',[callId])).rows[0];
  const rawEvidence=result?.rawReceipt||error?.rawReceipt||{errorCode:error?.code||'UNKNOWN_PROVIDER_OUTCOME'};
  await archiveCallEvidence(db,callId,result?'RESPONSE':'ERROR',rawEvidence);
  if(['SETTLED','REJECTED_UNBILLED','CANCELLED_UNBILLED','FAILED_BILLED'].includes(call.status))return;
  const usage=result?.usage||error?.usage,raw=result?.rawReceipt||error?.rawReceipt||{errorCode:error?.code||'UNKNOWN_PROVIDER_OUTCOME'};
  const providerId=result?.id||error?.generationId||call.provider_generation_id;
  if(result){
   const evaluation=evaluateAnswer(result.content,scope.problem);
   await db.query('INSERT INTO responses(id,attempt_id,provider_call_id,answer,answer_hash) VALUES($1,$2,$3,$4,$5) ON CONFLICT(attempt_id) DO NOTHING',[randomUUID(),scope.attempt_id,callId,result.content,digest(result.content)]);
   await db.query('UPDATE attempt_states SET status=$2,public_tests=$3,public_summary=$4,updated_at=clock_timestamp() WHERE attempt_id=$1',[scope.attempt_id,validUsage(usage)?'COMPLETED':'USAGE_PENDING',JSON.stringify(evaluation.publicTests),(evaluation.publicTests.every(t=>t.passed)?'All public checks passed.':'Some public checks did not pass.')+(evaluation.computedCost==null?'':' Recomputed shipping cost: '+evaluation.computedCost+'.')]);
  }
  if(validUsage(usage)){
   if(!(await db.query('SELECT id FROM provider_usage_receipts WHERE provider_call_id=$1',[callId])).rowCount){
    const incident=usage.totalTokens>num(call.reserved_tokens)||num(account.consumed)+usage.totalTokens+num(account.reserved)-num(call.reserved_tokens)>num(account.allowance);
    if(incident)await db.query('UPDATE token_accounts SET state=\'ACCOUNTING_INCIDENT\' WHERE participant_id=$1',[scope.participant_id]);
    await receipt(db,callId,usage,raw);
    await db.query('UPDATE token_accounts SET consumed=consumed+$2,reserved=reserved-$3 WHERE participant_id=$1',[scope.participant_id,usage.totalTokens,num(call.reserved_tokens)]);
    await db.query('INSERT INTO token_ledger_events(participant_id,provider_call_id,kind,consumed_delta,reserved_delta,evidence) VALUES($1,$2,\'SETTLE\',$3,$4,$5)',[scope.participant_id,callId,usage.totalTokens,-num(call.reserved_tokens),JSON.stringify({providerGenerationId:providerId,receiptDigest:digest(raw),boundIncident:incident})]);
    if(incident)await db.query('UPDATE participants SET workspace_state=\'ACCOUNTING_INCIDENT\' WHERE id=$1',[scope.participant_id]);
   }
   await db.query('UPDATE provider_calls SET status=$2,provider_generation_id=$3,completed_at=clock_timestamp(),failure_reason=$4 WHERE id=$1',[callId,result?'SETTLED':'FAILED_BILLED',providerId,error?.code||null]);
   if(!result)await db.query('UPDATE attempt_states SET status=\'FAILED_BILLED\' WHERE attempt_id=$1',[scope.attempt_id]);
  }else if(error?.classification==='DEFINITIVE_REJECTION'){
   await db.query('UPDATE token_accounts SET reserved=reserved-$2 WHERE participant_id=$1',[scope.participant_id,num(call.reserved_tokens)]);
   await db.query('INSERT INTO token_ledger_events(participant_id,provider_call_id,kind,reserved_delta,evidence) VALUES($1,$2,\'RELEASE\',$3,$4)',[scope.participant_id,callId,-num(call.reserved_tokens),JSON.stringify({reason:error.code,definitivelyUnprocessed:true})]);
   await db.query('UPDATE provider_calls SET status=\'REJECTED_UNBILLED\',failure_reason=$2,completed_at=clock_timestamp() WHERE id=$1',[callId,error.code]);
   await db.query('UPDATE attempt_states SET status=\'REJECTED_UNBILLED\' WHERE attempt_id=$1',[scope.attempt_id]);
  }else{
   await db.query('UPDATE provider_calls SET status=$2,provider_generation_id=$3,failure_reason=$4 WHERE id=$1',[callId,result?'USAGE_PENDING':'UNKNOWN',providerId,error?.code||'USAGE_MISSING']);
   if(!result)await db.query('UPDATE attempt_states SET status=\'FAILED_USAGE_PENDING\' WHERE attempt_id=$1',[scope.attempt_id]);
  }
  const selected=(await db.query('SELECT id FROM final_selections WHERE participant_id=$1',[scope.participant_id])).rows[0];
  if(selected)await enqueue(db,'FINALIZE',selected.id+':usage:'+callId,{selectionId:selected.id});
  await audit(db,scope.competition_id,null,'GENERATION_OUTCOME_RECORDED',{callId,attemptId:scope.attempt_id,providerGenerationId:providerId,usageKnown:validUsage(usage),totalTokens:validUsage(usage)?usage.totalTokens:null});
 });
}
export async function generate(callId:string){
 const dispatch=await transaction(async db=>{
  const scope=(await db.query('SELECT pc.*,a.participant_id,a.competition_id,a.prompt,c.problem,c.status AS competition_status,r.manifest FROM provider_calls pc JOIN attempts a ON a.id=pc.attempt_id JOIN competitions c ON c.id=a.competition_id JOIN competition_rules_versions r ON r.id=a.rules_version_id WHERE pc.id=$1',[callId])).rows[0];
  if(!scope)return null;scope.problem=await problemForManifest(scope.competition_id,scope.manifest,scope.problem,db);
  await db.query('SELECT id FROM competitions WHERE id=$1 FOR SHARE',[scope.competition_id]);
  const account=(await db.query('SELECT t.*,p.workspace_state,p.moderation_status FROM token_accounts t JOIN participants p ON p.id=t.participant_id WHERE t.participant_id=$1 FOR UPDATE OF t,p',[scope.participant_id])).rows[0];
  const call=(await db.query('SELECT * FROM provider_calls WHERE id=$1 FOR UPDATE',[callId])).rows[0];
  if(call.status!=='QUEUED'){
   if(call.status==='DISPATCHING'){
    await db.query('UPDATE provider_calls SET status=\'UNKNOWN\',failure_reason=\'INTERRUPTED_AFTER_DISPATCH\' WHERE id=$1',[callId]);
    await db.query('UPDATE attempt_states SET status=\'FAILED_USAGE_PENDING\' WHERE attempt_id=$1',[scope.attempt_id]);
   }return null;
  }
  if(account.moderation_status==='BANNED'||account.state!=='OPEN'||account.workspace_state!=='OPEN'||scope.competition_status!=='GENERATION_OPEN'){
   await db.query('UPDATE token_accounts SET reserved=reserved-$2 WHERE participant_id=$1',[scope.participant_id,num(call.reserved_tokens)]);
   await db.query('UPDATE provider_calls SET status=\'CANCELLED_UNBILLED\' WHERE id=$1',[callId]);
   await db.query('UPDATE attempt_states SET status=\'CANCELLED_BEFORE_DISPATCH\' WHERE attempt_id=$1',[scope.attempt_id]);
   await db.query('INSERT INTO token_ledger_events(participant_id,provider_call_id,kind,reserved_delta,evidence) VALUES($1,$2,\'RELEASE\',$3,$4)',[scope.participant_id,callId,-num(call.reserved_tokens),JSON.stringify({reason:'Workspace closed before dispatch'})]);return null;
  }
  const request={model:scope.model,provider:scope.provider,messages:[{role:'system' as const,content:scope.manifest.systemEnvelope},{role:'user' as const,content:scope.prompt}],maxOutputTokens:num(scope.manifest.maxOutputTokens),temperature:0,requestId:callId,...(scope.problem?.kind==='STRUCTURED_JSON'?{jsonSchema:scope.problem.structured.outputSchema}:{})};
  await db.query('UPDATE provider_calls SET status=\'DISPATCHING\',dispatched_at=clock_timestamp(),request_digest=$2,request_digest_version=\'sha256-json-c14n-v1\' WHERE id=$1',[callId,digest(request)]);
  await db.query('UPDATE attempt_states SET status=\'GENERATING\' WHERE attempt_id=$1',[scope.attempt_id]);
  await db.query('INSERT INTO provider_call_events(provider_call_id,kind,raw_evidence,evidence_digest) VALUES($1,\'REQUEST\',$2,$3) ON CONFLICT DO NOTHING',[callId,JSON.stringify(request),digest(request)]);
  await audit(db,scope.competition_id,null,'GENERATION_DISPATCH_INTENT',{callId,requestDigest:digest(request),model:scope.model});
  return request;
 });
 if(!dispatch)return;
 let result:CompletionResult;
 try{result=await router.complete(dispatch);}
 catch(e){
  const error=e instanceof OpenRouterError?e:new OpenRouterError('UNKNOWN_PROVIDER_FAILURE','AMBIGUOUS','Provider outcome is unknown.',{dispatched:true});
  await finish(callId,null,error);return;
 }
 if(result.model!==dispatch.model){
  await finish(callId,null,new OpenRouterError('MODEL_MISMATCH','AMBIGUOUS','The returned model does not match the frozen configuration.',{generationId:result.id,usage:result.usage,rawReceipt:result.rawReceipt,dispatched:true}));return;
 }
 await finish(callId,result,null);
}
export async function recoverGenerationUsage(){
 if(!config.apiKey)return;
 const calls=(await pool.query('SELECT * FROM provider_calls WHERE purpose=\'GENERATION\' AND status IN (\'UNKNOWN\',\'USAGE_PENDING\') AND provider_generation_id IS NOT NULL ORDER BY dispatched_at LIMIT 5')).rows;
 for(const call of calls){
  try{
   const recovered=await router.recover(call.provider_generation_id,call.model);
   if(!validUsage(recovered.usage))continue;
   const response=(await pool.query('SELECT answer FROM responses WHERE provider_call_id=$1',[call.id])).rows[0];
   if(response)await finish(call.id,{id:recovered.id,model:recovered.model,content:response.answer,usage:recovered.usage,rawReceipt:recovered.rawReceipt,clientRequestId:call.request_id},null);
   else await finish(call.id,null,new OpenRouterError('ANSWER_NOT_RECOVERABLE','AMBIGUOUS','Usage was recovered; answer text was not.',{generationId:recovered.id,usage:recovered.usage,rawReceipt:recovered.rawReceipt,dispatched:true}));
  }catch{ /* Unknown outcomes retain their original holds; no blind provider retry. */ }
 }
}
