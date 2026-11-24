import { randomUUID } from 'node:crypto';
import { SAMPLE_PROBLEM,stableUuid } from '@prompt-battle/core';
import type { AppUser } from './auth';
import { config,GENERATION_ENVELOPE,REVIEW_PACKAGE,REVIEW_PACKAGE_DIGEST } from './config';
import { transaction,audit } from './db';
import { competitionView,digest,competitionRow } from './domain';
import { fail } from './guards';
export function assertOrganizerScope(c:any,u:AppUser|null){
 if(!u)return; // Reserved for the internal deadline-closing worker.
 if(!u.isOrganizer||(c.organizer_id&&c.organizer_id!==u.id))fail(403,'This competition is managed by another organizer.');
}
export async function createCompetition(u:AppUser,title:string){
 if(!u.isOrganizer)fail(403,'Organizer access is required.');
 const id=randomUUID(),rulesId=randomUUID(),registryId=randomUUID();
 const base=structuredClone(SAMPLE_PROBLEM);
 const registry={...base.registry,id:randomUUID(),versionId:registryId,policyVersionId:randomUUID(),items:base.registry.items.map(i=>({...i,id:randomUUID()}))};
 const problem={...base,registry},calibration=!config.officialQualified;
 const manifest={version:3,reviewMode:'AUTOMATIC_REVIEWER',rankingMode:'EARLIEST_CORRECT_TIEBREAK_V1',tokenBudget:2000000,generationModel:config.generationModel,qualityModel:config.judgeModel,reviewerModel:config.reviewerModel,
 generationProvider:config.generationProvider,reviewProvider:config.reviewProvider,inputUpperBound:config.inputBound,maxOutputTokens:config.maxOutput,
 systemEnvelope:GENERATION_ENVELOPE,
 providerQualified:config.officialQualified,qualificationEvidence:config.qualificationEvidence,calibration,manualCloseAllowed:calibration,
 problemRevision:1,problemVersionId:problem.versionId,registryVersionId:registryId,scoreFormula:'quality-efficiency-v1',reviewPackage:REVIEW_PACKAGE,reviewPackageDigest:REVIEW_PACKAGE_DIGEST,reviewerModelVersionId:stableUuid(config.reviewerModel+':'+REVIEW_PACKAGE_DIGEST),maxPromptBytes:config.maxPromptBytes,penaltySchedule:{NONE:0,MINOR:1,MATERIAL:3}};
 await transaction(async db=>{
  await db.query('INSERT INTO competitions(id,title,problem,calibration,organizer_id,generation_cutoff,selection_cutoff,reveal_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval \'24 hours\',clock_timestamp()+interval \'25 hours\',clock_timestamp()+interval \'25 hours\')',[id,title,JSON.stringify(problem),calibration,u.id]);
  await db.query('INSERT INTO problem_versions(id,competition_id,version_id,sequence,content,digest) VALUES($1,$2,$3,1,$4,$5)',[randomUUID(),id,problem.versionId,JSON.stringify(problem),digest(problem)]);
  await db.query('INSERT INTO registry_versions(id,competition_id,sequence,registry,digest) VALUES($1,$2,1,$3,$4)',[registryId,id,JSON.stringify(registry),digest(registry)]);
  await db.query('INSERT INTO competition_rules_versions(id,competition_id,sequence,manifest,digest) VALUES($1,$2,1,$3,$4)',[rulesId,id,JSON.stringify(manifest),digest(manifest)]);
  await db.query('UPDATE competitions SET rules_version_id=$2,registry_version_id=$3 WHERE id=$1',[id,rulesId,registryId]);
  for(let n=1;n<=10;n++)await db.query('INSERT INTO invitations(competition_id,code_hash,username,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval \'30 days\')',[id,digest(id+':participant'+n+':'+randomUUID()),'participant'+n]);
  await audit(db,id,u.id,'COMPETITION_DRAFT_CREATED',{problemVersionId:problem.versionId,calibration,identityBoundInvitations:10});
 });
 return {competition:await competitionView(await competitionRow(id),u)};
}
