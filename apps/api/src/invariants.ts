import { createHash } from 'node:crypto';
export const MAX_PROMPT_BYTES=64000;
export function validatePromptInput(prompt:string):void{
 if(typeof prompt!=='string'||!prompt.trim()||prompt.includes('\0')||Buffer.byteLength(prompt,'utf8')>MAX_PROMPT_BYTES)throw new Error('Prompt must contain text within the published 64,000 UTF-8 byte limit.');
 if(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(prompt))throw new Error('Prompt contains an invalid Unicode sequence.');
}
const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
export function manifestQualified(m:any,expectedPackageDigest?:string):boolean{
 const e=m?.qualificationEvidence;
 return !!m?.providerQualified&&!!e&&e.status==='APPROVED'&&typeof e.approvedBy==='string'&&!!e.approvedBy.trim()&&Number.isFinite(Date.parse(e.approvedAt))&&
 e.models?.generation===m.generationModel&&e.models?.quality===m.qualityModel&&e.models?.reviewer===m.reviewerModel&&
 e.providers?.generation===m.generationProvider&&e.providers?.review===m.reviewProvider&&
 e.inputUpperBound===m.inputUpperBound&&e.maxOutputTokens===m.maxOutputTokens&&e.maxPromptBytes===m.maxPromptBytes&&m.maxPromptBytes===MAX_PROMPT_BYTES&&
 Number.isSafeInteger(m.inputUpperBound)&&m.inputUpperBound>0&&Number.isSafeInteger(m.maxOutputTokens)&&m.maxOutputTokens>0&&
 e.reviewPackage===m.reviewPackage&&e.reviewPackageDigest===m.reviewPackageDigest&&(!expectedPackageDigest||e.reviewPackageDigest===expectedPackageDigest)&&
 e.generationEnvelopeDigest===sha(m.systemEnvelope||'')&&e.allCountedOutputBounded===true&&e.usageRecoveryReviewed===true&&
 Array.isArray(e.authoritativeEvidence)&&e.authoritativeEvidence.length>0&&e.authoritativeEvidence.every((u:unknown)=>typeof u==='string'&&u.startsWith('https://'))&&
 /^[a-f0-9]{64}$/i.test(e.qualityBenchmarkDigest||'')&&/^[a-f0-9]{64}$/i.test(e.reviewerBenchmarkDigest||'')&&/^[a-f0-9]{64}$/i.test(e.digest||'');
}
export function currentScoreAvailable(submissionStatus:string,scoreDecisionId:string|null|undefined,effectiveDecisionId:string|null|undefined):boolean{
 return submissionStatus==='FINALIZED'&&!!scoreDecisionId&&scoreDecisionId===effectiveDecisionId;
}
export function publishedResultVisible(competitionStatus:string,submissionStatus:string,scoreDecisionId:string|null|undefined,effectiveDecisionId:string|null|undefined):boolean{
 return ['REVEALED','CALIBRATION_REVEALED'].includes(competitionStatus)&&currentScoreAvailable(submissionStatus,scoreDecisionId,effectiveDecisionId);
}
function exactCompare(a:string,b:string):number{
 if(!/^\d+(\.\d+)?$/.test(a)||!/^\d+(\.\d+)?$/.test(b))return Number(a)-Number(b);
 const [ai,af='']=a.split('.'),[bi,bf='']=b.split('.'),width=Math.max(af.length,bf.length);
 const x=BigInt(ai+af.padEnd(width,'0')),y=BigInt(bi+bf.padEnd(width,'0'));return x<y?-1:x>y?1:0;
}
export function compareLeaderboardRows(a:any,b:any):number{
 if(!!a.score!==!!b.score)return b.score?1:-1;
 const ae=!!a.score?.eligible,be=!!b.score?.eligible;if(ae!==be)return be?1:-1;
 const score=exactCompare(String(b.score?.finalScoreExact??b.score?.finalScore??0),String(a.score?.finalScoreExact??a.score?.finalScore??0));
 const timed=a.ranking_mode==='EARLIEST_CORRECT_TIEBREAK_V1'&&ae&&be;
 const at=a.solve_elapsed_ms==null?Infinity:Number(a.solve_elapsed_ms),bt=b.solve_elapsed_ms==null?Infinity:Number(b.solve_elapsed_ms);
 const preciseTime=timed&&Number.isFinite(at)&&Number.isFinite(bt)&&/^\d+(\.\d{1,6})?$/.test(String(a.first_correct_epoch??''))&&/^\d+(\.\d{1,6})?$/.test(String(b.first_correct_epoch??''))?exactCompare(String(a.first_correct_epoch),String(b.first_correct_epoch)):null;
 const time=timed?(preciseTime??(at<bt?-1:at>bt?1:0)):0;
 return score||time||Number(b.score?.quality||0)-Number(a.score?.quality||0)||Number(b.score?.correctness||0)-Number(a.score?.correctness||0)||Number(a.consumed)-Number(b.consumed);
}
