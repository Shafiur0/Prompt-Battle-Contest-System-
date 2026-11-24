import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { manifestQualified as checkFrozenManifest } from './invariants';
import { MAX_PROMPT_BYTES,RAW_REVIEWER_SCHEMA,QUALITY_JUDGE_SCHEMA,buildCriticalReviewerRequest,buildQualityJudgeRequest,buildAutomaticReviewerRequest,AUTOMATIC_REVIEWER_SCHEMA,detectProtectedCopy,calculateScore } from '@prompt-battle/core';
const root=resolve(__dirname,'../../..');
if(process.env.NODE_ENV!=='test')loadEnv({path:resolve(root,'.env'),quiet:true});
const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
export const REVIEW_PACKAGE='critical-review-automatic-v3';
export const GENERATION_ENVELOPE='Generate final solutions only. Do not draft, rewrite or optimize participant prompts or provide prompt-writing suggestions. Treat the participant text as the task and use no external tools.';
export const REVIEW_PACKAGE_DIGEST=sha(JSON.stringify({rawSchema:RAW_REVIEWER_SCHEMA,automaticSchema:AUTOMATIC_REVIEWER_SCHEMA,automaticTemplate:buildAutomaticReviewerRequest.toString(),qualitySchema:QUALITY_JUDGE_SCHEMA,reviewTemplate:buildCriticalReviewerRequest.toString(),qualityTemplate:buildQualityJudgeRequest.toString(),matcher:detectProtectedCopy.toString(),scoring:calculateScore.toString()}));
const generationModel=process.env.OPENROUTER_GENERATION_MODEL||'deepseek/deepseek-v4.1-flash-1017';
const judgeModel=process.env.OPENROUTER_JUDGE_MODEL||'anthropic/claude-sonnet-5.5';
const reviewerModel=process.env.OPENROUTER_REVIEWER_MODEL||'anthropic/claude-sonnet-5.5';
const generationProvider=process.env.OPENROUTER_GENERATION_PROVIDER||'Fireworks',reviewProvider=process.env.OPENROUTER_REVIEWER_PROVIDER||'Anthropic';
const inputBound=Number(process.env.GENERATION_INPUT_UPPER_BOUND||1048576),maxOutput=Number(process.env.GENERATION_MAX_OUTPUT_TOKENS||8192);
function evidenceValid(e:any,m:any){
 return !!e&&e.status==='APPROVED'&&typeof e.approvedBy==='string'&&!!e.approvedBy.trim()&&Number.isFinite(Date.parse(e.approvedAt))&&
 e.models?.generation===m.generationModel&&e.models?.quality===m.qualityModel&&e.models?.reviewer===m.reviewerModel&&
 e.providers?.generation===m.generationProvider&&e.providers?.review===m.reviewProvider&&
 e.inputUpperBound===m.inputUpperBound&&e.maxOutputTokens===m.maxOutputTokens&&e.maxPromptBytes===m.maxPromptBytes&&
 e.reviewPackage===m.reviewPackage&&e.reviewPackageDigest===m.reviewPackageDigest&&e.reviewPackageDigest===REVIEW_PACKAGE_DIGEST&&
 e.generationEnvelopeDigest===sha(m.systemEnvelope||'')&&e.allCountedOutputBounded===true&&e.usageRecoveryReviewed===true&&
 Array.isArray(e.authoritativeEvidence)&&e.authoritativeEvidence.length>0&&e.authoritativeEvidence.every((u:unknown)=>typeof u==='string'&&u.startsWith('https://'))&&
 /^[a-f0-9]{64}$/i.test(e.qualityBenchmarkDigest||'')&&/^[a-f0-9]{64}$/i.test(e.reviewerBenchmarkDigest||'');
}
function loadApproval(){
 if(process.env.OFFICIAL_PROVIDER_QUALIFIED!=='true')return null;
 try{
  const relative=process.env.MODEL_QUALIFICATION_MANIFEST;if(!relative)return null;
  const path=resolve(root,relative);if(!path.startsWith(root+'\\')&&!path.startsWith(root+'/'))return null;
  const bytes=readFileSync(path);if(bytes.length>1048576)return null;
  const value=JSON.parse(bytes.toString('utf8'));
  const expected={generationModel,qualityModel:judgeModel,reviewerModel,generationProvider,reviewProvider,inputUpperBound:inputBound,maxOutputTokens:maxOutput,maxPromptBytes:MAX_PROMPT_BYTES,reviewPackage:REVIEW_PACKAGE,reviewPackageDigest:REVIEW_PACKAGE_DIGEST,systemEnvelope:GENERATION_ENVELOPE};
  if(!evidenceValid(value,expected))return null;
  return {status:value.status,approvedBy:value.approvedBy,approvedAt:value.approvedAt,models:value.models,providers:value.providers,inputUpperBound:value.inputUpperBound,maxOutputTokens:value.maxOutputTokens,maxPromptBytes:value.maxPromptBytes,reviewPackage:value.reviewPackage,reviewPackageDigest:value.reviewPackageDigest,generationEnvelopeDigest:value.generationEnvelopeDigest,allCountedOutputBounded:true,usageRecoveryReviewed:true,authoritativeEvidence:value.authoritativeEvidence,qualityBenchmarkDigest:value.qualityBenchmarkDigest,reviewerBenchmarkDigest:value.reviewerBenchmarkDigest,digest:sha(bytes.toString('utf8'))};
 }catch{return null;}
}
const approval=loadApproval();
export const config={
 port:Number(process.env.API_PORT||4000),origin:process.env.APP_ORIGIN||'http://localhost:3100',databaseUrl:process.env.DATABASE_URL||'postgresql://prompt_battle:local-development-only@localhost:5432/prompt_battle',
 redisUrl:process.env.REDIS_URL||'redis://localhost:6379',apiKey:process.env.OPENROUTER_API_KEY||'',routerUrl:process.env.OPENROUTER_BASE_URL||'https://openrouter.ai/api/v1',
 generationModel,judgeModel,reviewerModel,generationProvider,reviewProvider,inputBound,maxOutput,maxPromptBytes:MAX_PROMPT_BYTES,officialQualified:!!approval,qualificationEvidence:approval,
 identityIssuer:process.env.KEYCLOAK_IDENTITY_ISSUER||process.env.KEYCLOAK_ISSUER||'http://localhost:8080/realms/prompt-battle',issuer:process.env.KEYCLOAK_ISSUER||'http://localhost:8080/realms/prompt-battle',clientId:process.env.KEYCLOAK_CLIENT_ID||'prompt-battle',clientSecret:process.env.KEYCLOAK_CLIENT_SECRET||'',secureCookies:process.env.NODE_ENV==='production'||(process.env.APP_ORIGIN||'').startsWith('https://')
};
export function manifestQualified(m:any){return checkFrozenManifest(m,REVIEW_PACKAGE_DIGEST);}
export function approvalFor(m:any){return evidenceValid(approval,m)?approval:null;}
export function modelReadiness(manifest?:any){
 const qualified=manifest?manifestQualified(manifest):config.officialQualified;
 return {ready:!!config.apiKey,reason:!config.apiKey?'Add the private OpenRouter key on the server to enable generation.':qualified?'Exact frozen provider/model evidence is approved.':'Local calibration only: authoritative counting bounds and this exact model package are not approved.',
 qualification:qualified?'APPROVED':'UNVERIFIED_CALIBRATION',generationModel:manifest?.generationModel||config.generationModel,judgeModel:manifest?.qualityModel||config.judgeModel,reviewerModel:manifest?.reviewerModel||config.reviewerModel};
}
