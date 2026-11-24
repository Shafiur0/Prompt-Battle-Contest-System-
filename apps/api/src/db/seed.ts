import { createHash } from 'node:crypto';
import { SAMPLE_PROBLEM, stableUuid } from '@prompt-battle/core';
import { config,GENERATION_ENVELOPE,REVIEW_PACKAGE,REVIEW_PACKAGE_DIGEST } from '../config';
import { pool, transaction, audit } from './index';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
async function main() {
 const competitionId = stableUuid('local-calibration-competition');
 const rulesId = stableUuid('local-calibration-rules:v1');
 const registryId = stableUuid('local-calibration-registry:v1');
 const problem = { ...SAMPLE_PROBLEM, registry: { ...SAMPLE_PROBLEM.registry, versionId: registryId } };
 const manifest = {
  version: 3, reviewMode:'AUTOMATIC_REVIEWER',rankingMode:'EARLIEST_CORRECT_TIEBREAK_V1',problemRevision:1, tokenBudget: 2000000, generationModel: config.generationModel, qualityModel: config.judgeModel,
  reviewerModel: config.reviewerModel, generationProvider: config.generationProvider, reviewProvider: config.reviewProvider,
  systemEnvelope: GENERATION_ENVELOPE,
  maxOutputTokens: config.maxOutput, inputUpperBound: config.inputBound, providerQualified: config.officialQualified,
  calibration: true, manualCloseAllowed: true, problemVersionId: problem.versionId, registryVersionId: registryId,
  scoreFormula: 'quality-efficiency-v1', reviewPackage: REVIEW_PACKAGE,reviewPackageDigest:REVIEW_PACKAGE_DIGEST,reviewerModelVersionId:stableUuid(config.reviewerModel+':'+REVIEW_PACKAGE_DIGEST), penaltySchedule: { NONE: 0, MINOR: 1, MATERIAL: 3 }
 };
 await transaction(async db => {
  const inserted = await db.query('INSERT INTO competitions(id,title,problem,generation_cutoff,selection_cutoff,reveal_at) VALUES($1,$2,$3,clock_timestamp()+interval \'24 hours\',clock_timestamp()+interval \'25 hours\',clock_timestamp()+interval \'25 hours\') ON CONFLICT DO NOTHING RETURNING id',
   [competitionId, 'Supply Allocation · Local Calibration', JSON.stringify(problem)]);
  if (inserted.rowCount) {
   await db.query('INSERT INTO registry_versions(id,competition_id,sequence,registry,digest) VALUES($1,$2,1,$3,$4)',
    [registryId, competitionId, JSON.stringify(problem.registry), hash(JSON.stringify(problem.registry))]);
   await db.query('INSERT INTO competition_rules_versions(id,competition_id,sequence,manifest,digest) VALUES($1,$2,1,$3,$4)',
    [rulesId, competitionId, JSON.stringify(manifest), hash(JSON.stringify(manifest))]);
   await db.query('UPDATE competitions SET rules_version_id=$2,registry_version_id=$3 WHERE id=$1',[competitionId,rulesId,registryId]);
   await audit(db,competitionId,null,'COMPETITION_DRAFT_CREATED',{problemVersionId:problem.versionId,calibration:true});
  }
  for (let n=1;n<=10;n++) {
   const code='LOCAL-PARTICIPANT-'+String(n).padStart(2,'0');
   await db.query('INSERT INTO invitations(competition_id,code_hash,username,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval \'30 days\') ON CONFLICT DO NOTHING',
    [competitionId,hash(code),'participant'+n]);
  }
 });
 console.log('Local calibration competition and ten identity-bound invitations are ready.');
 await pool.end();
}
main().catch(() => { console.error('Database seed failed; inspect server database configuration.'); process.exitCode=1; });
