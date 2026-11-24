/** Read-only, test-competition-scoped audit. No dotenv, model calls or DB writes. */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { SYSTEM_TEST_MARKER, SYSTEM_TEST_TITLE_PREFIX, SYSTEM_TEST_SCENARIOS, SYSTEM_TEST_RULE } from './system-test-fixtures.mjs';
const require = createRequire(import.meta.url);
const { Pool } = require('pg');
const core = require('@prompt-battle/core');
const sdk = require('@prompt-battle/openrouter');
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const n = value => value == null ? 0 : Number(value);
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
const closeEnough = (a,b) => Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Math.abs(Number(a)-Number(b)) <= 1e-10;
const time = value => value == null ? NaN : new Date(value).getTime();
const terminalCalls = new Set(['SETTLED','FAILED_BILLED','REJECTED_UNBILLED','CANCELLED_UNBILLED']);
export function normalizeObservations(packet) {
 if(packet&&typeof packet==='object'&&packet.observations&&typeof packet.observations==='object')return {...packet.observations,competitionId:packet.competitionId,steps:Array.isArray(packet.steps)?packet.steps:[],actorPlans:(Array.isArray(packet.actors)?packet.actors:[]).map(actor=>({alias:actor.alias,type:actor.type,prompts:Array.isArray(actor.prompts)?actor.prompts.filter(value=>typeof value==='string'):[]}))};
 return packet;
}
export function announcementInterval(observation,observations,announcements) {
 const at=time(observation.observedAt);
 if(Number.isFinite(at))return {start:at,end:at,exact:true,source:'RECORDED_OBSERVATION_TIMESTAMP'};
 const steps=observations.steps||[];
 const published=steps.find(step=>step.passed!==false&&step.name==='Administrator publishes operational announcement');
 const withdrawn=steps.find(step=>step.passed!==false&&typeof step.name==='string'&&step.name.startsWith('Withdraw announcement'));
 const start=time(published?.at),recordedEnd=time(withdrawn?.at);
 if(!Number.isFinite(start)||!Number.isFinite(recordedEnd)||recordedEnd<=start)return null;
 const knownWithdrawals=announcements.map(row=>time(row.withdrawn_at)).filter(value=>Number.isFinite(value)&&value>start&&value<=recordedEnd);
 // The checkpoint's publish/read/withdraw sequence places these recorded reads
 // after publication and strictly before the first withdrawal. This is an
 // interval reconstructed from real records, not an invented observedAt.
 return {start,end:knownWithdrawals.length?Math.min(...knownWithdrawals):recordedEnd,exact:false,source:'CHECKPOINT_PUBLISH_READ_WITHDRAW_INTERVAL'};
}
function parseArgs(argv) {
 const args = { allowPending: false, pretty: false, selfTest: false };
 for(let i=0;i<argv.length;i++) {
  const key=argv[i];
  if(key==='--allow-pending')args.allowPending=true;
  else if(key==='--pretty')args.pretty=true;
  else if(key==='--self-test')args.selfTest=true;
  else if(['--competition','--expected-title','--observations'].includes(key)) { if(!argv[i+1])throw new Error('INVALID_AUDIT_ARGUMENTS');args[key.slice(2).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=argv[++i]; }
  else throw new Error('UNSUPPORTED_AUDIT_ARGUMENT');
 }
 if(!args.selfTest && !uuid.test(args.competition||''))throw new Error('A_STRICT_TEST_COMPETITION_UUID_IS_REQUIRED');
 return args;
}
function issues() {
 const failures=[],warnings=[],pending=[];
 return {failures,warnings,pending,
  check(condition,code,scope,detail){if(!condition)failures.push({code,scope,detail});},
  warn(code,scope,detail){warnings.push({code,scope,detail});},
  wait(code,scope,detail){pending.push({code,scope,detail});}
 };
}
function usageForReceipt(receipt) {
 const raw=receipt.raw_receipt;
 return raw && typeof raw==='object' && raw.data ? sdk.normalizeRecoveryUsage(raw.data) : sdk.normalizeCompletionUsage(raw?.usage);
}
export function verifyTokenAccount(participant,calls,receipts,ledger,result) {
 const genCalls=calls.filter(call=>call.purpose==='GENERATION'&&call.participant_id===participant.id);
 const ids=new Set(genCalls.map(call=>call.id));
 const genReceipts=receipts.filter(receipt=>ids.has(receipt.provider_call_id));
 const events=ledger.filter(event=>event.participant_id===participant.id);
 const consumed=genReceipts.reduce((sum,row)=>sum+n(row.total_tokens),0);
 const reserved=genCalls.filter(call=>!terminalCalls.has(call.status)).reduce((sum,call)=>sum+n(call.reserved_tokens),0);
 const ledgerConsumed=events.reduce((sum,event)=>sum+n(event.consumed_delta),0);
 const ledgerReserved=events.reduce((sum,event)=>sum+n(event.reserved_delta),0);
 const available=n(participant.allowance)-n(participant.consumed)-n(participant.reserved);
 result.check(n(participant.allowance)===2000000,'ALLOWANCE_CHANGED',participant.alias,'The test participant allowance must remain 2000000.');
 result.check(n(participant.consumed)===consumed,'RECEIPT_ACCOUNT_MISMATCH',participant.alias,`Account usage ${n(participant.consumed)} differs from generation receipts ${consumed}.`);
 result.check(n(participant.reserved)===reserved,'RESERVATION_ACCOUNT_MISMATCH',participant.alias,`Account hold ${n(participant.reserved)} differs from unresolved calls ${reserved}.`);
 result.check(ledgerConsumed===n(participant.consumed)&&ledgerReserved===n(participant.reserved),'LEDGER_ACCOUNT_MISMATCH',participant.alias,'Ledger deltas must reproduce confirmed and reserved balances.');
 result.check(available>=0||participant.account_state==='ACCOUNTING_INCIDENT','NEGATIVE_AVAILABLE_WITHOUT_INCIDENT',participant.alias,'Unexpected budget excess must be recorded as an incident.');
 for(const event of events)if(event.provider_call_id)result.check(ids.has(event.provider_call_id),'ORGANIZER_USAGE_IN_PARTICIPANT_LEDGER',participant.alias,'Only generation calls may affect participant accounting.');
 const unsettled=genCalls.filter(call=>!terminalCalls.has(call.status));
 if(unsettled.length)result.wait('GENERATION_USAGE_PENDING',participant.alias,`${unsettled.length} generation calls remain unresolved; their holds must not be refunded.`);
 return {confirmedUsed:n(participant.consumed),reserved:n(participant.reserved),available,receiptGenerationTokens:consumed,ledgerConsumed,ledgerReserved,generationCalls:genCalls.length,unsettledCalls:unsettled.length};
}
function savedTestsMatch(actual,expected) {
 if(!Array.isArray(actual)||actual.length!==expected.length)return false;
 const byId=new Map(actual.map(row=>[row.id,row]));
 return expected.every(row=>{const saved=byId.get(row.id);return saved&&saved.passed===row.passed&&saved.essential===row.essential&&saved.group===row.group&&saved.visibility===row.visibility&&closeEnough(saved.weight,row.weight);});
}
function knownScore(row) {return !!row&&typeof row.finalScore==='number'&&Number.isFinite(row.finalScore)&&typeof row.quality==='number'&&Number.isFinite(row.quality);}
function rankRows(participants,states,selections,scores) {
 const visible=[];
 for(const p of participants) {
  const f=selections.find(row=>row.participant_id===p.id),state=f&&states.find(row=>row.selection_id===f.id),revision=state&&scores.find(row=>row.id===state.published_score_id);
  if(p.moderation_status==='BANNED'||!state||state.status!=='FINALIZED'||!revision||revision.decision_id!==state.effective_decision_id)continue;
  visible.push({alias:p.alias,score:revision.score,tokens:n(p.consumed)});
 }
 visible.sort((a,b)=>Number(b.score.eligible)-Number(a.score.eligible)||n(b.score.finalScore)-n(a.score.finalScore)||n(b.score.quality)-n(a.score.quality)||n(b.score.correctness)-n(a.score.correctness)||a.tokens-b.tokens);
 let rank=0,previous='';
 return visible.map((row,index)=>{const key=canonical([row.score.eligible,row.score.finalScoreExact??row.score.finalScore,row.score.quality,row.score.correctness,row.tokens]);if(key!==previous){rank=index+1;previous=key;}return {alias:row.alias,rank,eligible:row.score.eligible,score:row.score.finalScore,quality:row.score.quality,correctness:row.score.correctness,tokens:row.tokens};});
}
export function verifySnapshot(data,observations=null) {
 observations=normalizeObservations(observations);
 const result=issues(),c=data.competition,manifest=c.manifest,registry=data.registry;
 result.check(data.participants.length===10,'PARTICIPANT_COUNT',c.id,`Expected ten enrolled test actors; found ${data.participants.length}.`);
 result.check(c.calibration===true,'TEST_ROUND_NOT_CALIBRATION',c.id,'The isolated system-test round must retain calibration labeling.');
 result.check(c.problem?.kind==='STRUCTURED_JSON'&&c.problem.statement.includes(SYSTEM_TEST_MARKER),'WRONG_TEST_PROBLEM',c.id,'The round must contain the explicit synthetic problem marker.');
 result.check(c.problem.versionId===manifest.problemVersionId,'FROZEN_PROBLEM_VERSION_MISMATCH',c.id,'The assigned problem and frozen manifest must identify one version.');
 result.check(registry.versionId===manifest.registryVersionId&&registry.versionId===c.registry_version_id,'FROZEN_REGISTRY_MISMATCH',c.id,'Registry, assignment and published manifest must match.');
 if(c.closure_epoch) {
  result.check(data.closure?.epoch===c.closure_epoch,'CLOSURE_EPOCH_MISMATCH',c.id,'The closure epoch must match its immutable proof.');
  try{core.assertIntegrityReviewAllowed(data.closure?.proof);}catch{result.check(false,'INVALID_GLOBAL_CLOSURE',c.id,'Global closure must end enrollment, generation and selection for every workspace.');}
 }else result.wait('COMPETITION_NOT_CLOSED',c.id,'Final integrity review must not run before recorded global closure.');
 const modelFor={GENERATION:manifest.generationModel,QUALITY:manifest.qualityModel,REVIEWER:manifest.reviewerModel};
 const providerFor={GENERATION:manifest.generationProvider,QUALITY:manifest.reviewProvider,REVIEWER:manifest.reviewProvider};
 const generationIdentities=new Map();let inputTokens=0,outputTokens=0,totalTokens=0,organizerTokens=0,cachedSubset=0,reasoningSubset=0,knownCost=0,unknownCost=0,digestReproduced=0,digestUnreplayable=0;
 for(const call of data.calls) {
  result.check(call.model===modelFor[call.purpose]&&call.provider===providerFor[call.purpose],'FROZEN_MODEL_OR_PROVIDER_CHANGED',call.id,'A physical call must use the frozen model and provider.');
  if(call.provider_generation_id){const prior=generationIdentities.get(call.provider_generation_id);result.check(!prior||prior===call.id,'DUPLICATE_PROVIDER_GENERATION_ID',call.id,'One provider identity must not be charged as two physical calls.');generationIdentities.set(call.provider_generation_id,call.id);}
  const archived=data.callEvents.filter(row=>row.provider_call_id===call.id);
  const requestEvent=archived.find(row=>row.kind==='REQUEST'),request=requestEvent?.raw_evidence;
  if(request&&typeof request==='object') {
   if(request.model!==undefined)result.check(request.model===call.model,'ARCHIVED_REQUEST_MODEL_MISMATCH',call.id,'Archived request must match the frozen call model.');
   if(typeof request.provider==='string')result.check(request.provider===call.provider,'ARCHIVED_REQUEST_PROVIDER_MISMATCH',call.id,'Archived request must match the selected provider.');
   if(call.purpose==='GENERATION') {
    const attempt=data.attempts.find(row=>row.id===call.attempt_id);
    result.check((request.maxOutputTokens??request.max_tokens)===manifest.maxOutputTokens,'OUTPUT_CAP_CHANGED',call.id,'Generation output cap must remain frozen.');
    if(attempt&&Array.isArray(request.messages))result.check(request.messages.length===2&&request.messages[0].content===manifest.systemEnvelope&&request.messages[1].content===attempt.prompt,'GENERATION_CONTEXT_CHANGED',call.id,'Generator context must contain only the fixed envelope and immutable participant prompt.');
   } else if(request.jsonSchema) {
    const expectedSchema=call.purpose==='QUALITY'?core.QUALITY_JUDGE_SCHEMA:core.RAW_REVIEWER_SCHEMA;
    result.check(canonical(request.jsonSchema)===canonical(expectedSchema),'MODEL_OUTPUT_SCHEMA_CHANGED',call.id,'Judge/reviewer calls must use their frozen typed contract.');
    for(const message of request.messages||[])if(message.role==='user')try{
     const packet=JSON.parse(message.content);
     result.check(!Object.hasOwn(packet,'referenceAnswer')&&!Object.hasOwn(packet,'reference_answer')&&!Object.hasOwn(packet,'private_checks'),'PRIVATE_REFERENCE_IN_MODEL_PACKET',call.id,'Reference answers and private expected values must not enter generator/reviewer packets.');
     if(call.purpose==='REVIEWER')result.check(!(packet.information_registry||[]).some(item=>item.category==='PRIVATE_EVALUATION_CRITERIA'),'PRIVATE_CRITERIA_IN_REVIEWER_PACKET',call.id,'Private criterion content must not become a copying source.');
    }catch{result.check(false,'UNREADABLE_ARCHIVED_MODEL_PACKET',call.id,'A structured model packet must remain parseable.');}
   }
  }
  if(['SETTLED','FAILED_BILLED'].includes(call.status))result.check(archived.some(row=>['RESPONSE','ERROR','RECOVERY_RESPONSE'].includes(row.kind)),'RAW_RECEIPT_NOT_ARCHIVED',call.id,'Terminal usage must retain original response/error evidence.');
  for(const event of archived){if(event.evidence_digest===hash(event.raw_evidence)||event.evidence_digest===hash(canonical(event.raw_evidence)))digestReproduced++;else digestUnreplayable++;}
  if(call.purpose==='REVIEWER')result.check(c.closure_epoch&&time(call.dispatched_at)>=time(data.closure?.closed_at),'REVIEWER_DISPATCH_BEFORE_CLOSURE',call.id,'Integrity inference must start after global closure.');
 }
 for(const receipt of data.receipts) {
  const call=data.calls.find(row=>row.id===receipt.provider_call_id);if(!call){result.check(false,'ORPHAN_RECEIPT',receipt.id,'Receipt must belong to the scoped physical call.');continue;}
  result.check(n(receipt.total_tokens)===n(receipt.input_tokens)+n(receipt.output_tokens),'RECEIPT_TOTAL_MISMATCH',call.id,'Totals must equal input plus output.');
  let usage;try{usage=usageForReceipt(receipt);}catch{result.check(false,'INVALID_RAW_USAGE',call.id,'Native usage cannot be normalized consistently.');}
  result.check(!!usage,'RAW_USAGE_MISSING',call.id,'Numeric receipts must retain authoritative raw token fields.');
  if(usage) {
   result.check(usage.inputTokens===n(receipt.input_tokens)&&usage.outputTokens===n(receipt.output_tokens)&&usage.totalTokens===n(receipt.total_tokens),'RAW_RECEIPT_NUMERIC_MISMATCH',call.id,'Stored usage must match original provider fields.');
   cachedSubset+=usage.cachedInputTokens??0;reasoningSubset+=usage.reasoningTokens??0;
   if(usage.costUsd===undefined)unknownCost++;else knownCost+=usage.costUsd;
  }
  if(call.purpose==='GENERATION'){inputTokens+=n(receipt.input_tokens);outputTokens+=n(receipt.output_tokens);totalTokens+=n(receipt.total_tokens);}else organizerTokens+=n(receipt.total_tokens);
 }
 if(digestUnreplayable)result.warn('JSON_DIGEST_PREIMAGE_UNAVAILABLE',c.id,`${digestUnreplayable} object digests cannot be replayed from JSONB alone; numeric/semantic checks do not claim byte-level proof.`);
 const participantReports=[];
 for(const p of data.participants) {
  const stats=verifyTokenAccount(p,data.calls,data.receipts,data.ledger,result),attempts=data.attempts.filter(a=>a.participant_id===p.id).sort((a,b)=>a.version-b.version),scenario=SYSTEM_TEST_SCENARIOS.find(row=>row.alias===p.alias);
  result.check(attempts.length>=1,'MISSING_TEST_ATTEMPT',p.alias,'Each enrolled actor should exercise generation.');
  result.check(attempts.every((a,index)=>a.version===index+1),'VERSION_SEQUENCE_INVALID',p.alias,'Attempts must have a contiguous immutable version sequence.');
  for(const a of attempts) {
   result.check(a.prompt_hash===hash(a.prompt),'PROMPT_HASH_MISMATCH',a.id,'Historical prompt bytes must match their hash.');
   if(a.parent_attempt_id)result.check(attempts.some(parent=>parent.id===a.parent_attempt_id),'CROSS_PARTICIPANT_PARENT',a.id,'A restored prompt must reference an owned attempt.');
   const response=data.responses.find(r=>r.attempt_id===a.id);
   if(response)result.check(response.answer_hash===hash(response.answer),'ANSWER_HASH_MISMATCH',response.id,'Immutable answer bytes must match their hash.');
   const runCalls=data.calls.filter(call=>call.attempt_id===a.id&&call.purpose==='GENERATION');
   result.check(runCalls.every(call=>call.model===manifest.generationModel&&call.provider===manifest.generationProvider),'VERSION_MODEL_CHANGED',a.id,'Generations must retain frozen model/provider.');
  }
  const selection=data.selections.find(row=>row.participant_id===p.id),state=selection&&data.states.find(row=>row.selection_id===selection.id),response=selection&&data.responses.find(row=>row.id===selection.response_id);
  if(!selection){result.wait('FINAL_SELECTION_MISSING',p.alias,'No final answer has been chosen; missing selection is not fabricated.');participantReports.push({alias:p.alias,scenario:scenario?.type??'UNMAPPED',moderation:p.moderation_status??'ACTIVE',versions:attempts.length,...stats});continue;}
  result.check(attempts.some(a=>a.id===selection.attempt_id)&&response?.attempt_id===selection.attempt_id,'FINAL_SELECTION_OWNERSHIP_MISMATCH',p.alias,'Selected prompt/answer must be an owned version.');
  if(scenario&&attempts.length<scenario.minAttempts)result.warn('VERSION_SCENARIO_NOT_EXERCISED',p.alias,`Scenario ${scenario.type} needs ${scenario.minAttempts} attempts; ${attempts.length} were saved.`);
  const selectedAttempt=attempts.find(a=>a.id===selection.attempt_id),quality=data.qualities.find(row=>row.selection_id===selection.id),detection=data.detections.find(row=>row.selection_id===selection.id),report=data.reports.find(row=>row.selection_id===selection.id),decision=state&&data.decisions.find(row=>row.id===state.effective_decision_id),tokenSnapshot=data.snapshots.find(row=>row.selection_id===selection.id),score=state&&data.scores.find(row=>row.id===state.published_score_id);
  const plannedActor=observations?.actorPlans?.find(actor=>actor.alias===p.alias),plannedPrompts=plannedActor?.prompts?.length?plannedActor.prompts:scenario?.prompts||[];
  const scenarioPromptExecuted=!!selectedAttempt&&plannedPrompts.some(prompt=>prompt===selectedAttempt.prompt);
  if(plannedPrompts.length)result.check(scenarioPromptExecuted,'SYNTHETIC_SCENARIO_PROMPT_NOT_EXECUTED',p.alias,'The actual selected prompt does not match any recorded synthetic scenario input; do not attribute this fixture mismatch to the model.');
  let expectedEvaluation=null,qualityJ=null,qualityPasses=0,qualityNeedsHuman=false;
  if(response)try{expectedEvaluation=core.evaluateAnswer(response.answer,c.problem);}catch{result.check(false,'FROZEN_PROBLEM_CONFIGURATION_INVALID',p.alias,'Retained problem configuration cannot evaluate the selected answer.');}
  if(quality&&expectedEvaluation) {
   result.check(savedTestsMatch(quality.evaluation.finalTests,expectedEvaluation.finalTests)&&closeEnough(quality.evaluation.C,expectedEvaluation.C)&&closeEnough(quality.evaluation.K,expectedEvaluation.K)&&quality.evaluation.eligible===expectedEvaluation.eligible,'SAVED_DETERMINISTIC_CHECKS_MISMATCH',p.alias,'Stored public/private checks must reproduce the frozen evaluator.');
   if(Array.isArray(quality.judgments)) {
    qualityPasses=quality.judgments.length;
    try{const aggregate=core.aggregateQualityJudgments(quality.judgments,response.answer);qualityJ=aggregate.J;qualityNeedsHuman=aggregate.needsHumanReview;if(!aggregate.needsHumanReview)result.check(closeEnough(quality.j,aggregate.J),'QUALITY_AGGREGATE_MISMATCH',p.alias,'J must match two validated quality passes.');}catch{qualityNeedsHuman=true;result.warn('QUALITY_SCHEMA_OR_PASS_REVIEW_REQUIRED',p.alias,'Quality pass/evidence needs a recorded human fallback.');}
   }
   const human=data.humanQualities.filter(row=>row.selection_id===selection.id).sort((a,b)=>time(b.created_at)-time(a.created_at))[0];
   if(human){qualityJ=n(human.j);const values=human.ordinal_scores;result.check(!!values&&closeEnough(qualityJ,(2*n(values.clarity)+2*n(values.justification)+n(values.concision))/20),'HUMAN_QUALITY_ORDINAL_MISMATCH',p.alias,'Human J must derive from approved ordinal scores.');}
   else if(qualityNeedsHuman)result.wait('HUMAN_QUALITY_PENDING',p.alias,'Quality disagreement/unavailable judgment remains unresolved.');
  }else result.wait('QUALITY_EVALUATION_PENDING',p.alias,'Selected quality evaluation is incomplete.');
  if(response&&expectedEvaluation?.parsed) {
   const parsed=expectedEvaluation.parsed;
   const mathValid=parsed&&typeof parsed==='object'&&Number.isSafeInteger(parsed.result)&&parsed.result===6*7;
   if(expectedEvaluation.eligible)result.check(mathValid,'INDEPENDENT_MATH_CHECK_FAILED',p.alias,'An eligible synthetic answer must independently equal six times seven.');
   if(scenarioPromptExecuted&&scenario?.expectedEligibility==='ineligible_if_negative_control_obeyed'&&expectedEvaluation.eligible)result.warn('NEGATIVE_CONTROL_CORRECTED_BY_MODEL',p.alias,`The ${scenario.type} model answer did not exercise the intended failure.`);
  }
  let copyMatches=0;
  if(selectedAttempt&&detection) {
   try{const expected=core.detectProtectedCopy(selectedAttempt.prompt,registry);copyMatches=expected.matches.length;result.check(closeEnough(expected.copyRatio,detection.detection.copyRatio)&&canonical(expected.matches.map(m=>[m.id,m.itemId,m.promptRange,m.sourceRange]))===canonical(detection.detection.matches.map(m=>[m.id,m.itemId,m.promptRange,m.sourceRange])),'COPY_EVIDENCE_MISMATCH',p.alias,'Evidence must reproduce exact selected-prompt/source ranges.');}catch{result.check(false,'COPY_EVIDENCE_INVALID',p.alias,'Selected prompt/registry evidence cannot be verified.');}
   const run=data.runs.find(row=>row.id===detection.run_id);result.check(!!run&&run.closure_epoch===c.closure_epoch&&time(run.created_at)>=time(data.closure?.closed_at),'DETECTION_BEFORE_CLOSURE',p.alias,'Matching must start after global closure.');
   if(scenario?.expectedCopy&&copyMatches===0)result.check(false,'COPY_SCENARIO_NOT_EXERCISED',p.alias,'The required copied-passage scenario produced no protected evidence; fixture coverage is incomplete, not a confirmed violation.');
   if(scenario&&!scenario.expectedCopy&&copyMatches>0)result.warn('ORIGINAL_SCENARIO_OVERLAP_FLAGGED',p.alias,'Original/required-fact overlap needs contextual human review.');
  }else result.wait('INTEGRITY_DETECTION_PENDING',p.alias,'Post-closure evidence is incomplete.');
  if(report&&selectedAttempt&&detection) {
   try{
    const context={competitionId:c.id,participantId:p.id,selectedAttemptId:selection.attempt_id,reviewerModelVersionId:manifest.reviewerModelVersionId||core.stableUuid(manifest.reviewerModel+':critical-review-prepared-v1'),closure:data.closure.proof,prompt:selectedAttempt.prompt,problem:{...c.problem,registry},detection:detection.detection};
    const expected=core.buildCanonicalReviewReport(context,report.raw_output);
    result.check(canonical(expected)===canonical(report.report),'CANONICAL_REVIEW_REPORT_MISMATCH',p.alias,'Server identities, metrics and advisory fields must match the frozen packet.');
    result.check(report.report.human_review_required===true&&!('penaltyPoints' in report.report)&&report.report.verdict!=='CONFIRMED_VIOLATION','MACHINE_HAS_HUMAN_AUTHORITY',p.alias,'A machine report cannot confirm guilt or authorize points.');
   }catch{result.check(false,'REVIEWER_SCHEMA_OR_EVIDENCE_INVALID',p.alias,'Saved machine report violates its strict contract.');}
  }
  if(!decision)result.wait('HUMAN_INTEGRITY_SIGNOFF_PENDING',p.alias,'Every final prompt requires human sign-off, including clear reports.');
  else {
   result.check(data.organizers.includes(decision.actor_id),'NON_ORGANIZER_HUMAN_DECISION',p.alias,'Adjudication must identify an authorized organizer.');
   result.check([0,1,3].includes(n(decision.penalty))&&(decision.verdict==='CONFIRMED_VIOLATION'||n(decision.penalty)===0),'INVALID_HUMAN_PENALTY',p.alias,'Only confirmed human findings may apply published points.');
   if(decision.verdict==='CONFIRMED_VIOLATION') {
    result.check(registry.items.some(item=>item.category==='PROTECTED_CRITICAL_INFORMATION'&&item.publicRuleId===decision.rule_id),'UNKNOWN_CONFIRMED_PUBLIC_RULE',p.alias,'Confirmation must name a frozen public restriction.');
    result.check(n(decision.penalty)===(decision.severity==='MINOR'?1:decision.severity==='MATERIAL'?3:-1),'HUMAN_SEVERITY_PENALTY_MISMATCH',p.alias,'Approved points must follow the recorded published severity.');
    if(decision.rule_id===SYSTEM_TEST_RULE)result.check(decision.severity==='MINOR'&&n(decision.penalty)===1,'SYSTEM_TEST_RULE_PENALTY_MISMATCH',p.alias,'The synthetic commentary rule explicitly uses the published MINOR schedule.');
   }
   if(decision.mode==='HUMAN_ONLY')result.check(!!decision.failure_provenance&&!decision.report_id,'INVALID_HUMAN_ONLY_PROVENANCE',p.alias,'Human fallback needs failure evidence and no fabricated AI report.');
   if(decision.verdict==='INSUFFICIENT_EVIDENCE')result.wait('INTEGRITY_DECISION_INCONCLUSIVE',p.alias,'Inconclusive evidence cannot authorize points or clearance.');
  }
  if(tokenSnapshot)result.check(n(tokenSnapshot.consumed)===stats.confirmedUsed&&stats.reserved===0,'FINAL_TOKEN_SNAPSHOT_MISMATCH',p.alias,'Final T must include every settled generation attempt.');
  const scoreReady=state?.status==='FINALIZED'&&score&&score.decision_id===state.effective_decision_id;
  if(scoreReady&&knownScore(score.score)&&expectedEvaluation&&decision&&decision.verdict!=='INSUFFICIENT_EVIDENCE'&&qualityJ!=null&&tokenSnapshot) {
   const expected=core.calculateScore({C:expectedEvaluation.C,K:expectedEvaluation.K,J:qualityJ,T:n(tokenSnapshot.consumed),eligible:expectedEvaluation.eligible,reviewedCopyingPenaltyPoints:n(decision.penalty)});
   result.check(closeEnough(expected.finalScore,score.score.finalScore)&&closeEnough(expected.Q,score.score.quality)&&closeEnough(expected.E,score.score.efficiency)&&score.score.tokenUsage===stats.confirmedUsed,'FINAL_SCORE_REPLAY_MISMATCH',p.alias,'Score must replay from exact tests, J, cumulative T and human points.');
  }else result.wait('FINAL_SCORE_PENDING',p.alias,'Exact finalized score inputs/revision links are incomplete.');
  if(p.moderation_status==='BANNED')result.check(attempts.length>0&&!!selection&&!!response,'BANNED_HISTORY_LOST',p.alias,'A ban must preserve historical content and accounting.');
  participantReports.push({alias:p.alias,scenario:scenario?.type??'UNMAPPED',scenarioPromptExecuted,moderation:p.moderation_status??'ACTIVE',versions:attempts.length,selectedVersion:selectedAttempt?.version??null,...stats,publicChecksPassed:expectedEvaluation?.publicTests.filter(t=>t.passed).length??null,finalChecksPassed:expectedEvaluation?.finalTests.filter(t=>t.passed).length??null,C:expectedEvaluation?.C??null,K:expectedEvaluation?.K??null,J:qualityJ,eligible:expectedEvaluation?.eligible??null,qualityPasses,qualityNeedsHumanReview:qualityNeedsHuman,machineVerdict:report?.report?.verdict??null,copyMatches,humanVerdict:decision?.verdict??null,humanPenalty:decision?n(decision.penalty):null,finalScore:scoreReady?score.score.finalScore:null});
 }
 const expectedRanks=rankRows(data.participants,data.states,data.selections,data.scores);
 const visibleAnnouncements=data.announcements.filter(row=>!row.withdrawn_at).length;
 for(const event of data.moderation)result.check(data.organizers.includes(event.actor_id),'NON_ORGANIZER_MODERATION',event.id,'Moderation must be an authenticated human action.');
 for(const event of data.audit)result.check(event.digest===event.recomputed_digest,'AUDIT_CHAIN_DIGEST_MISMATCH',event.id,'Audit event must match its PostgreSQL JSONB preimage.');
 for(let index=0;index<data.audit.length;index++)result.check(n(data.audit[index].sequence)===index+1&&(index===0?data.audit[index].previous_digest==='':data.audit[index].previous_digest===data.audit[index-1].digest),'AUDIT_CHAIN_LINK_MISMATCH',data.audit[index].id,'Audit sequence and predecessor links must be contiguous.');
 const requiredTriggers=['competition_rules_versions','registry_versions','problem_versions','attempts','responses','final_selections','provider_usage_receipts','provider_call_events','token_ledger_events','quality_evaluations','quality_human_reviews','policy_reviews','integrity_detections','integrity_reports','token_snapshots','score_revisions','moderation_events','announcements'];
 for(const name of requiredTriggers)result.check(data.immutableTables.includes(name),'IMMUTABILITY_TRIGGER_MISSING',name,'History must retain update/delete protection.');
 if(observations) {
  result.check(observations.competitionId===c.id,'OBSERVATION_SCOPE_MISMATCH',c.id,'Actor observations must identify this test round.');
  if(observations.leaderboard) {
   const actual=observations.leaderboard.rows||[];
   for(const banned of data.participants.filter(p=>p.moderation_status==='BANNED'))result.check(!actual.some(row=>row.alias===banned.alias&&row.rank!=null),'BANNED_ACTOR_STILL_RANKED',banned.alias,'Banned actors cannot receive a current rank.');
   for(const expected of expectedRanks){const row=actual.find(item=>item.alias===expected.alias);result.check(!!row&&row.rank===expected.rank&&closeEnough(row.score,expected.score),'API_RANKING_DIFFERS_FROM_RECORDED_INPUTS',expected.alias,'Observed standings must match the published tie rules.');}
  }
  for(const observation of observations.announcementAccess||[]) {
   const actor=data.participants.find(p=>p.alias===observation.alias),interval=announcementInterval(observation,observations,data.announcements),actualIds=[...(observation.visibleIds||[])].sort();
   const allIds=new Set(data.announcements.map(row=>row.id));
   result.check(actualIds.every(id=>allIds.has(id)),'ANNOUNCEMENT_CROSS_SCOPE_ID',observation.alias,'Recorded announcements must belong to the dedicated test competition.');
   if(!interval){
    result.warn('ANNOUNCEMENT_TIMING_UNRECORDED',observation.alias,'No exact timestamp or recorded publish/read/withdraw interval is available; current withdrawal state is not treated as evidence of an earlier leak.');
    result.check(actor?observation.httpStatus===200:[401,403].includes(observation.httpStatus),'ANNOUNCEMENT_ACCESS_STATUS',observation.alias,'Only enrolled actors should read announcements.');
    if(!actor)result.check(actualIds.length===0,'NON_MEMBER_ANNOUNCEMENT_CONTENT',observation.alias,'A non-member must not receive announcement content.');
    continue;
   }
   const membershipTime=time(actor?.created_at),alwaysMember=!!actor&&membershipTime<=interval.start,neverMember=!actor||membershipTime>interval.end;
   result.check(alwaysMember?observation.httpStatus===200:neverMember?[401,403].includes(observation.httpStatus):[200,401,403].includes(observation.httpStatus),'ANNOUNCEMENT_ACCESS_STATUS',observation.alias,'Access must match membership throughout the recorded observation interval.');
   const alwaysVisible=[],possiblyVisible=[];
   if(!neverMember)for(const row of data.announcements){
    const created=time(row.created_at),withdrawal=time(row.withdrawn_at);
    const wasPossible=interval.exact?created<=interval.start&&(!Number.isFinite(withdrawal)||withdrawal>interval.start):created<interval.end&&(!Number.isFinite(withdrawal)||withdrawal>interval.start);
    const wasAlways=alwaysMember&&created<=interval.start&&(!Number.isFinite(withdrawal)||(interval.exact?withdrawal>interval.end:withdrawal>=interval.end));
    if(wasPossible)possiblyVisible.push(row.id);if(wasAlways)alwaysVisible.push(row.id);
   }
   result.check(actualIds.every(id=>possiblyVisible.includes(id))&&alwaysVisible.every(id=>actualIds.includes(id)),'ANNOUNCEMENT_SCOPE_OR_WITHDRAWAL_LEAK',observation.alias,'Recorded identities must fit historical publication/membership, not the current withdrawn state.');
   if(!interval.exact&&possiblyVisible.some(id=>!alwaysVisible.includes(id)))result.warn('ANNOUNCEMENT_INTERVAL_STATE_CHANGE',observation.alias,'Historical interval includes a state transition; only provable visibility requirements were asserted.');
  }
 }
 return {competitionId:c.id,title:c.title,status:c.status,calibration:c.calibration,auditedAt:new Date().toISOString(),ok:result.failures.length===0&&result.pending.length===0,
  summary:{participants:data.participants.length,attemptVersions:data.attempts.length,finalSelections:data.selections.length,generationCalls:data.calls.filter(row=>row.purpose==='GENERATION').length,qualityCalls:data.calls.filter(row=>row.purpose==='QUALITY').length,integrityCalls:data.calls.filter(row=>row.purpose==='REVIEWER').length,generationInputTokens:inputTokens,generationOutputTokens:outputTokens,generationTotalTokens:totalTokens,organizerTokens,cachedInputSubset:cachedSubset,reasoningOutputSubset:reasoningSubset,knownReportedCostUsd:knownCost,costReceiptsMissing:unknownCost,bannedActors:data.participants.filter(row=>row.moderation_status==='BANNED').length,moderationEvents:data.moderation.length,activeAnnouncements:visibleAnnouncements,totalAnnouncements:data.announcements.length,archivedDigestsReplayed:digestReproduced,archivedDigestsUnreplayable:digestUnreplayable},
  participants:participantReports,expectedRanks,failures:result.failures,warnings:result.warnings,pending:result.pending,
  assurance:{scope:'Only the designated synthetic competition was queried.',modelAssessment:'Schema/evidence consistency is checked; this does not assert perfect AI judgment or genuine reasoning.',apiAccess:observations?'Actor observations were compared with the scoped database snapshot.':'HTTP access is tested separately by the root runner; this verifier makes no API calls.'}};
}
async function snapshot(client,competitionId,args) {
 const metadata=(await client.query('SELECT id,title,status,calibration FROM competitions WHERE id=$1',[competitionId])).rows[0];
 if(!metadata)throw new Error('TEST_COMPETITION_NOT_FOUND');
 if(args.expectedTitle ? metadata.title!==args.expectedTitle : !metadata.title.startsWith(SYSTEM_TEST_TITLE_PREFIX))throw new Error('REFUSING_NON_TEST_COMPETITION_SCOPE');
 if(metadata.calibration!==true)throw new Error('REFUSING_OFFICIAL_OR_PRODUCTION_COMPETITION');
 const q=async sql=>(await client.query(sql,[competitionId])).rows;
 const competition=(await q('SELECT c.*,r.manifest FROM competitions c JOIN competition_rules_versions r ON r.id=c.rules_version_id WHERE c.id=$1'))[0];
 if(!competition.problem?.statement?.includes(SYSTEM_TEST_MARKER))throw new Error('SYNTHETIC_FIXTURE_MARKER_MISSING');
 const registry=(await q('SELECT registry FROM registry_versions WHERE id=(SELECT registry_version_id FROM competitions WHERE id=$1) AND competition_id=$1'))[0].registry;
 const callScope="(pc.attempt_id IN(SELECT id FROM attempts WHERE competition_id=$1) OR pc.evaluation_run_id IN(SELECT id FROM evaluation_runs WHERE competition_id=$1))";
 const data={competition,registry};
 data.participants=await q('SELECT p.*,u.alias,t.allowance,t.consumed,t.reserved,t.state AS account_state FROM participants p JOIN users u ON u.id=p.user_id JOIN token_accounts t ON t.participant_id=p.id WHERE p.competition_id=$1 ORDER BY u.alias');
 data.attempts=await q('SELECT a.*,s.status FROM attempts a JOIN attempt_states s ON s.attempt_id=a.id WHERE a.competition_id=$1');
 data.responses=await q('SELECT r.* FROM responses r JOIN attempts a ON a.id=r.attempt_id WHERE a.competition_id=$1');
 data.selections=await q('SELECT * FROM final_selections WHERE competition_id=$1');
 data.states=await q('SELECT s.* FROM submission_states s JOIN final_selections f ON f.id=s.selection_id WHERE f.competition_id=$1');
 data.calls=await q(`SELECT pc.*,a.participant_id FROM provider_calls pc LEFT JOIN attempts a ON a.id=pc.attempt_id WHERE ${callScope}`);
 data.receipts=await q(`SELECT r.* FROM provider_usage_receipts r JOIN provider_calls pc ON pc.id=r.provider_call_id WHERE ${callScope}`);
 data.callEvents=await q(`SELECT e.* FROM provider_call_events e JOIN provider_calls pc ON pc.id=e.provider_call_id WHERE ${callScope}`);
 data.ledger=await q('SELECT l.* FROM token_ledger_events l JOIN participants p ON p.id=l.participant_id WHERE p.competition_id=$1');
 data.runs=await q('SELECT * FROM evaluation_runs WHERE competition_id=$1');
 data.closure=(await q('SELECT * FROM closure_proofs WHERE competition_id=$1'))[0]??null;
 for(const [key,table]of [['qualities','quality_evaluations'],['humanQualities','quality_human_reviews'],['detections','integrity_detections'],['reports','integrity_reports'],['decisions','policy_reviews'],['snapshots','token_snapshots'],['scores','score_revisions']])data[key]=await q(`SELECT x.* FROM ${table} x JOIN final_selections f ON f.id=x.selection_id WHERE f.competition_id=$1`);
 data.moderation=await q('SELECT id,participant_id,actor_id,action,created_at FROM moderation_events WHERE competition_id=$1');
 data.announcements=await q('SELECT a.id,a.actor_id,a.created_at,s.withdrawn_at FROM announcements a LEFT JOIN announcement_states s ON s.announcement_id=a.id WHERE a.competition_id=$1');
 data.audit=await q("SELECT id,sequence,kind,previous_digest,digest,encode(pg_catalog.sha256(pg_catalog.convert_to(previous_digest||kind||payload::text,'UTF8')),'hex') AS recomputed_digest FROM audit_events WHERE competition_id=$1 ORDER BY sequence");
 data.immutableTables=(await client.query("SELECT DISTINCT c.relname AS name FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace ns ON ns.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid WHERE ns.nspname='battle' AND NOT t.tgisinternal AND t.tgenabled IN('O','A') AND (t.tgtype::integer & 16)=16 AND (t.tgtype::integer & 8)=8 AND (t.tgtype::integer & 2)=2 AND p.proname='reject_immutable_change'")).rows.map(row=>row.name);
 data.organizers=(await q("SELECT DISTINCT u.id FROM users u WHERE u.is_organizer=true AND (u.id=(SELECT organizer_id FROM competitions WHERE id=$1) OR u.id IN(SELECT d.actor_id FROM policy_reviews d JOIN final_selections f ON f.id=d.selection_id WHERE f.competition_id=$1) OR u.id IN(SELECT actor_id FROM moderation_events WHERE competition_id=$1) OR u.id IN(SELECT actor_id FROM announcements WHERE competition_id=$1))")).map(row=>row.id);
 return data;
}
async function selfTest() {
 const p={id:'test-participant',alias:'synthetic',allowance:2000000,consumed:150,reserved:0,account_state:'FINALIZED'};
 const calls=[{id:'test-call',purpose:'GENERATION',participant_id:p.id,status:'SETTLED',reserved_tokens:200}];
 const receipts=[{provider_call_id:'test-call',total_tokens:150}];
 const ledger=[{participant_id:p.id,provider_call_id:'test-call',consumed_delta:0,reserved_delta:200},{participant_id:p.id,provider_call_id:'test-call',consumed_delta:150,reserved_delta:-200}];
 let result=issues();const stats=verifyTokenAccount(p,calls,receipts,ledger,result);assert.equal(result.failures.length,0);assert.equal(stats.available,1999850);
 result=issues();verifyTokenAccount({...p,consumed:151},calls,receipts,ledger,result);assert.ok(result.failures.some(row=>row.code==='RECEIPT_ACCOUNT_MISMATCH'));
 result=issues();verifyTokenAccount({...p,consumed:0,reserved:200},[{...calls[0],status:'UNKNOWN'}],[],[ledger[0]],result);assert.equal(result.failures.length,0);assert.equal(result.pending.length,1);
 const historical={competitionId:'synthetic',observations:{announcementAccess:[]},steps:[{name:'Administrator publishes operational announcement',passed:true,at:'2026-11-20T21:00:01Z'},{name:'Withdraw announcement retains operational history',passed:true,at:'2026-11-20T21:01:01Z'}]};
 const normalized=normalizeObservations(historical);assert.equal(normalized.competitionId,'synthetic');
 const ann=[{id:'ann',created_at:'2026-11-20T21:00:00Z',withdrawn_at:'2026-11-20T21:01:00Z'}];
 const interval=announcementInterval({},normalized,ann);assert.equal(interval.exact,false);assert.equal(interval.end,time(ann[0].withdrawn_at));assert.ok(interval.start<interval.end);
 console.log(JSON.stringify({selfTest:'passed',cases:5,databaseQueries:0,providerCalls:0,environmentFilesRead:0}));
}
async function main() {
 const args=parseArgs(process.argv.slice(2));if(args.selfTest){await selfTest();return;}
 const databaseUrl=process.env.SYSTEM_TEST_DATABASE_URL||process.env.DATABASE_URL;
 if(!databaseUrl)throw new Error('INJECT_DATABASE_URL_WITHOUT_LOADING_ENV_FILES');
 let observations=null;
 if(args.observations){const path=resolve(args.observations);if(relative(root,path).startsWith('..')||/\.env(?:\.|$)/i.test(path))throw new Error('INVALID_OBSERVATION_PATH');observations=normalizeObservations(JSON.parse(await readFile(path,'utf8')));if(observations.competitionId!==args.competition)throw new Error('OBSERVATIONS_BELONG_TO_ANOTHER_ROUND');}
 const pool=new Pool({connectionString:databaseUrl,max:1,application_name:'prompt-battle-readonly-system-audit',options:'-c search_path=battle -c default_transaction_read_only=on',statement_timeout:10000,connectionTimeoutMillis:10000});
 const client=await pool.connect();
 try{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const readOnly=(await client.query('SHOW transaction_read_only')).rows[0]?.transaction_read_only;if(readOnly!=='on')throw new Error('READ_ONLY_TRANSACTION_REQUIRED');
  const data=await snapshot(client,args.competition,args),report=verifySnapshot(data,observations);
  await client.query('ROLLBACK');console.log(JSON.stringify(report,null,args.pretty?2:0));
  process.exitCode=report.failures.length?1:report.pending.length&&!args.allowPending?2:0;
 }finally{try{await client.query('ROLLBACK');}catch{}client.release();await pool.end();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{
 const code=typeof error?.message==='string'&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'AUDIT_EXECUTION_FAILED';
 console.error(JSON.stringify({error:code,databaseErrorCode:typeof error?.code==='string'&&/^[A-Z0-9_]+$/.test(error.code)?error.code:null,providerCalls:0,environmentFilesRead:0}));process.exitCode=1;
});
