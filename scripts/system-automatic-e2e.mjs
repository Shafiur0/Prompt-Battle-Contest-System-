import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
require('dotenv').config({quiet:true});
import {buildSystemTestProblemDraft,SYSTEM_TEST_TITLE_PREFIX,SYSTEM_TEST_RULE,SYSTEM_TEST_PROTECTED_COMMENTARY,SYSTEM_TEST_SCENARIOS} from './system-test-fixtures.mjs';
const run=promisify(execFile),root=process.cwd(),origin=process.env.APP_ORIGIN||'http://localhost:3100';
// Scope all browser test runtime files to this workspace (D:), including the CLI daemon registry.
const browserTemp=path.join(root,'.local','browser-temp');
const browserAppData=path.join(browserTemp,'appdata'),browserTmp=path.join(browserTemp,'tmp'),browserProfiles=path.join(browserTemp,'profiles');
for(const d of [browserAppData,browserTmp,browserProfiles]){
 const absolute=path.resolve(d);if(!absolute.startsWith(path.resolve(root)+path.sep))throw Error('Browser storage outside workspace');
 fs.mkdirSync(absolute,{recursive:true});
}
function sessionProfile(session){
 if(typeof session!=='string'||! /^[a-z0-9_-]{1,80}$/i.test(session))throw Error('Invalid isolated browser session name');
 const absolute=path.resolve(browserProfiles,session);if(!absolute.startsWith(path.resolve(browserProfiles)+path.sep))throw Error('Browser profile outside test storage');
 return absolute;
}
const browserEnv={...process.env,TEMP:browserTmp,TMP:browserTmp,LOCALAPPDATA:browserAppData,XDG_CACHE_HOME:path.join(browserTemp,'cache')};
const npx=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npx-cli.js');
if(!fs.existsSync(npx))throw new Error('npx runtime unavailable');
if(!process.argv.includes('--live-ai'))throw new Error('This test makes paid model calls. Pass --live-ai explicitly.');
const resumeArg=process.argv.indexOf('--resume');
const resumeDir=resumeArg>=0?path.resolve(process.argv[resumeArg+1]||''):null;
if(resumeDir&&!resumeDir.startsWith(path.join(root,'.local/system-tests')+path.sep))throw new Error('Resume directory outside isolated test area');
const previous=resumeDir?JSON.parse(fs.readFileSync(path.join(resumeDir,'run.json'),'utf8')):null;

const runId=previous?.runId||new Date().toISOString().replace(/[:.]/g,'-'),dir=resumeDir||path.join(root,'.local/system-tests',runId);
fs.mkdirSync(dir,{recursive:true});
const state=previous||{runId,title:SYSTEM_TEST_TITLE_PREFIX+' · Automatic ten participant exercise · '+runId,competitionId:null,steps:[],actors:[],observations:{announcementAccess:[]},expectedGenerationRequests:11,status:'RUNNING'};
if(state.failure){state.previousFailures??=[];state.previousFailures.push({status:state.status,failure:state.failure,archivedAt:new Date().toISOString()});delete state.failure;}
state.status='RUNNING';
state.expectedGenerationRequests=11;delete state.expectedMinimumTotalProviderRequests;delete state.paidRequestsExpected;
function save(){fs.writeFileSync(path.join(dir,'run.json'),JSON.stringify(state,null,2));}
function log(message){console.log(new Date().toISOString()+' '+message);}
function assert(value,message){if(!value)throw new Error(message);}
function scrub(text){return text.replaceAll('local-participant-change-me','[LOCAL FIXTURE PASSWORD]').replaceAll('local-organizer-change-me','[LOCAL FIXTURE PASSWORD]');}
async function cli(session,command,args=[],json=false){
 const argv=[npx,'--yes','--package','@playwright/cli','playwright-cli','-s='+session,command,...args,...(json?['--json']:[])];
 try{const r=await run(process.execPath,argv,{cwd:root,env:browserEnv,timeout:120000,maxBuffer:16*1024*1024});fs.appendFileSync(path.join(dir,'cli.log'),scrub(r.stdout+r.stderr)+'\n');if(!json)return r.stdout;const start=r.stdout.indexOf('{');if(start<0)throw new Error('Missing JSON CLI response');return JSON.parse(r.stdout.slice(start));}
 catch(e){fs.appendFileSync(path.join(dir,'cli.log'),scrub(String(e.stdout||'')+String(e.stderr||''))+'\n');throw new Error('Browser action failed for '+session+' / '+command+': '+scrub(String(e.stderr||e.message)).slice(0,500));}
}
function flatten(nodes,out=[]){for(const node of nodes||[]){if(node&&typeof node==='object'){out.push(node);flatten(node.children,out);}}return out;}
async function snapshot(session){const r=await cli(session,'snapshot',[],true);return r.snapshot||[];}
function find(nodes,role,name){const matches=flatten(nodes).filter(n=>n.role===role&&(typeof name==='string'?n.name===name:name.test(n.name||'')));if(matches.length!==1)throw new Error('Expected one '+role+' '+name+', found '+matches.length);return matches[0];}
async function target(session,role,name){for(let i=0;i<15;i++){try{return find(await snapshot(session),role,name);}catch(e){if(i===14)throw e;await new Promise(r=>setTimeout(r,500));}}}
async function click(session,role,name){const n=await target(session,role,name);assert(!n.disabled,'Control disabled: '+name);await cli(session,'click',[n.ref]);}
async function fill(session,name,value){
 const n=await target(session,'textbox',name);
 if(value.includes('\n')||value.includes('\r')){
  await cli(session,'run-code',['async(page)=>{const field=page.getByRole("textbox",{name:'+JSON.stringify(name)+',exact:true});await field.fill('+JSON.stringify(value)+');return {exact:(await field.inputValue())==='+JSON.stringify(value)+'};}'],true);
 }else await cli(session,'fill',[n.ref,value]);
 const r=await cli(session,'run-code',['async(page)=>({exact:(await page.getByRole("textbox",{name:'+JSON.stringify(name)+',exact:true}).inputValue())==='+JSON.stringify(value)+'})'],true);
 const result=typeof r.result==='string'?JSON.parse(r.result):r.result;assert(result.exact,'Browser field did not preserve complete text: '+name);
}
async function api(session,route,method='GET',body,key){
 const headers={Origin:origin};if(body!==undefined)headers['Content-Type']='application/json';if(key)headers['Idempotency-Key']=key;
 const options={method,headers,...(body!==undefined?{data:body}:{})};
 const source='async (page) => { const r=await page.request.fetch('+JSON.stringify(origin+'/api/v1'+route)+','+JSON.stringify(options)+'); let body;try{body=await r.json();}catch{body={};}return {status:r.status(),body}; }';
 const r=await cli(session,'run-code',[source],true);return typeof r.result==='string'?JSON.parse(r.result):r.result;
}
async function ok(session,route,method='GET',body,key){const r=await api(session,route,method,body,key);assert(r.status>=200&&r.status<300,route+' rejected: '+r.status+' '+JSON.stringify(r.body));return r.body;}
async function step(name,fn){log(name);const result=await fn();state.steps.push({name,passed:true,at:new Date().toISOString()});save();return result;}
async function login(session,alias){
 await cli(session,'open',[origin,'--browser=chrome','--idle-timeout=0','--profile='+sessionProfile(session)]);
 const existing=await api(session,'/session');if(existing.body.authenticated&&existing.body.user?.alias===alias)return;
 await click(session,'link','Sign in');
 await fill(session,'Username or email',alias);
 await fill(session,'Password',alias==='organizer'?'local-organizer-change-me':'local-participant-change-me');
 await click(session,'button','Sign In');
 for(let i=0;i<20;i++){const r=await api(session,'/session');if(r.body.authenticated){assert(r.body.user.alias===alias,'Incorrect actor identity');return;}await new Promise(r=>setTimeout(r,500));}
 throw new Error('Actor login did not finish: '+alias);
}
async function workspace(session){
 const nodes=flatten(await snapshot(session)),menu=nodes.find(n=>n.role==='button'&&n.name==='Current competition');
 if(menu){
  assert(!menu.disabled,'Competition selector is disabled');await cli(session,'click',[menu.ref]);
  const dialog=await target(session,'dialog','Choose a competition'),samples=find(dialog.children,'checkbox','Show samples and tests');
  await cli(session,'check',[samples.ref]);
  const search=await target(session,'combobox','Search competitions');await cli(session,'fill',[search.ref,state.title]);
  let option;
  for(let i=0;i<15;i++){
   const matches=flatten(await snapshot(session)).filter(n=>n.role==='option'&&(n.name||'').startsWith(state.title));
   if(matches.length===1){option=matches[0];break;}
   if(i===14)throw Error('Expected one competition option for '+state.title+', found '+matches.length);
   await new Promise(r=>setTimeout(r,500));
  }
  assert(!option.disabled,'Competition option is disabled');await cli(session,'click',[option.ref]);
 }else{
  const select=nodes.find(n=>n.role==='combobox'&&n.name==='Current competition');
  if(select)await cli(session,'select',[select.ref,state.competitionId]);
 }
 await click(session,'button','Workspace');
}
async function join(session){
 await workspace(session);
 const view=await ok(session,'/competitions/'+state.competitionId);
 if(view.member)return;
 await click(session,'button','Join competition');
 let nodes=await snapshot(session),dialog=find(nodes,'dialog','Join the competition');
 const checkbox=flatten(dialog.children).find(n=>n.role==='checkbox');assert(checkbox,'Rules acceptance missing');
 await cli(session,'check',[checkbox.ref]);
 nodes=await snapshot(session);dialog=find(nodes,'dialog','Join the competition');
 const button=find(dialog.children,'button','Join competition');assert(!button.disabled,'Enrollment did not accept rules');await cli(session,'click',[button.ref]);
 for(let i=0;i<15;i++){const r=await api(session,'/competitions/'+state.competitionId+'/token-account');if(r.status===200){assert(r.body.allowance===2000000&&r.body.confirmedUsed===0&&r.body.reserved===0,'Unexpected initial wallet');return;}await new Promise(r=>setTimeout(r,500));}
 throw new Error('Enrollment failed');
}
async function generation(session,prompt){
 await workspace(session);
 const old=await ok(session,'/competitions/'+state.competitionId+'/attempts'),before=old.attempts.length;
 await fill(session,'Your manually written prompt',prompt);
 // Controls are selected from a fresh real snapshot; no internal app state is fabricated.
 await click(session,'button','Generate answer');
 let attempt;
 for(let i=0;i<150;i++){
  const list=await ok(session,'/competitions/'+state.competitionId+'/attempts');
  attempt=list.attempts.find(a=>a.version===before+1);
  if(attempt?.answer&&attempt.totalTokens!==null){assert(attempt.prompt===prompt,"Stored prompt differs from the exact tested text; no retry sent");const wallet=await ok(session,'/competitions/'+state.competitionId+'/token-account');if(wallet.reserved===0)return attempt;}
  if(attempt&&/FAILED_BILLED|REJECTED_UNBILLED|CANCELLED|FAILED_USAGE_PENDING/.test(attempt.status))throw new Error('Generation ended '+attempt.status+' for '+session);
  await new Promise(r=>setTimeout(r,1000));
 }
 throw new Error('Generation/usage unresolved for '+session+'; no retry was sent');
}
async function choose(session,attempt){
 await workspace(session);
 const nodes=await snapshot(session),select=flatten(nodes).find(n=>n.role==='combobox'&&n.name==='View answer version');
 if(select)await cli(session,'select',[select.ref,attempt.id]);
 await click(session,'button','Submit this solution');
 const modal=find(await snapshot(session),'dialog','Submit your final solution'),button=find(modal.children,'button','Lock final choice');assert(!button.disabled,'Final choice not enabled');await cli(session,'click',[button.ref]);
 for(let i=0;i<20;i++){const c=await ok(session,'/competitions/'+state.competitionId);if(c.submissionId)return c.submissionId;await new Promise(r=>setTimeout(r,500));}
 throw new Error('Final selection failed');
}
async function mapLimit(values,limit,fn){const out=new Array(values.length);let cursor=0;await Promise.all(Array.from({length:limit},async()=>{while(cursor<values.length){const i=cursor++;out[i]=await fn(values[i],i);}}));return out;}

// This is a synthetic QA exercise. It does not provide prompt-writing assistance in the product.
const suffix=state.runId.replace(/[^a-z0-9]/gi,'').slice(-16),admin='auto-admin-'+suffix;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const route='/organizer/competitions/';
function testDraft(operand=6){
 const d=buildSystemTestProblemDraft();
 d.statement=d.statement.replace('subject to human review','subject to automatic reviewer assessment').replace('Compute six multiplied by seven.', 'Compute '+operand+' multiplied by seven.');
 d.title=operand+' times seven · Automatic synthetic system test';
 d.objectives=['Produce the correct integer product of '+operand+' and seven.'];
 d.checks[0].expected=operand*7;
 d.referenceAnswer={result:operand*7,rationale:operand+' groups of seven give '+operand*7+'.'};
 return d;
}
async function restoreBranch(actor){await workspace(actor.session);await click(actor.session,'button',/^Restore prompt to draft/);}
function noLiveHints(attempt){
 assert(attempt.prompt&&attempt.answer,'Expected immutable generated attempt');
 for(const key of ['integrityReport','integrityNotice','copyEvidence','copyScore','review','decision','copyingPenalty'])assert(attempt[key]==null,'Active attempt leaked '+key);
 assert(!/detected protected|possible violation|copy score|copying penalty applied/i.test(attempt.evaluationSummary||''),'Active feedback revealed integrity findings');
}
async function recoverOrGenerate(actor,index,prompt){
 const history=(await ok(actor.session,'/competitions/'+state.competitionId+'/attempts')).attempts;
 let a=history.find(a=>a.version===index+1);
 if(a){
  assert(a.prompt===prompt,'Existing test attempt has a different prompt; no replacement call allowed');
  for(let i=0;i<240;i++){
   a=(await ok(actor.session,'/attempts/'+a.id));
   if(a.answer&&a.totalTokens!=null&&(await ok(actor.session,'/competitions/'+state.competitionId+'/token-account')).reserved===0)return a;
   if(/FAILED_BILLED|REJECTED_UNBILLED|CANCELLED|FAILED_USAGE_PENDING/.test(a.status))throw Error('Stored generation remains '+a.status+'; no retry was sent');
   await sleep(1000);
  }
  throw Error('Previously admitted generation remains unresolved; no duplicate call was sent');
 }
 return generation(actor.session,prompt);
}
async function waitFinalized(){
 let last;
 for(let i=0;i<360;i++){
  last=await ok(admin,route+state.competitionId);
  if(last.cases.length===10&&last.cases.every(c=>c.status==='FINALIZED'&&c.decision?.source==='AI_REVIEWER'&&c.score))return last;
  if(i%20===0){state.observations.reviewProgress=last.cases.map(c=>({alias:c.alias,status:c.status,verdict:c.decision?.verdict,reason:c.contextualFailure,qualityPending:c.qualityReviewRequired}));save();log('Automatic review: '+last.cases.filter(c=>c.status==='FINALIZED').length+'/10 finalized');}
  await sleep(1000);
 }
 state.observations.pendingDashboard=last;save();throw Error('Automatic review or quality remains pending; no human grade or fabricated penalty supplied');
}
async function browserAudit(){
 const board=await ok(admin,route+state.competitionId);
 const rows=await ok(admin,'/competitions/'+state.competitionId+'/leaderboard');
 assert(rows.rows.length===10,'Leaderboard must retain all ten actors');
 assert(rows.rankingMode==='EARLIEST_CORRECT_TIEBREAK_V1','Wrong published ranking mode');
 state.observations.leaderboard=rows;state.observations.finalDashboard=board;
 for(const actor of state.actors){
  actor.final=await ok(actor.session,'/submissions/'+actor.submissionId);
  actor.wallet=await ok(actor.session,'/competitions/'+state.competitionId+'/token-account');
  actor.history=(await ok(actor.session,'/competitions/'+state.competitionId+'/attempts')).attempts;
  assert(actor.history.length===(actor.alias==='participant10'?2:1),'Unexpected physical generation history');
  assert(actor.wallet.reserved===0&&actor.wallet.allowance===2000000,'Unsettled or changed allowance');
  const sum=actor.history.reduce((s,a)=>s+a.totalTokens,0);
  assert(actor.wallet.confirmedUsed===sum&&actor.wallet.available===2000000-sum,'Wallet does not equal all attempts');
  assert(actor.final.score?.tokenUsage===sum,'Final score omitted abandoned generation usage');
  assert(actor.final.integrityNotice?.source==='AI_REVIEWER','Participant final notice is not automatic');
  const selected=actor.history.find(a=>a.id===actor.selectedAttemptId),c=board.cases.find(c=>c.alias===actor.alias);
  assert(c?.prompt===selected?.prompt&&c.answer===selected.answer,'Review used the wrong immutable final prompt/answer');
  assert(c.problemVersionId===selected.problemVersionId&&actor.final.score.problemVersionId===selected.problemVersionId,'Final evaluation rewrote the original problem revision');
  assert(c.decision?.source==='AI_REVIEWER'&&[0,1,3].includes(c.decision.penalty),'No supported automatic decision');
  if(c.decision.penalty>0)assert(c.copyEvidence.some(e=>e.ruleId===SYSTEM_TEST_RULE&&e.classification==='PROTECTED_CANDIDATE')&&c.decision.ruleIds.includes(SYSTEM_TEST_RULE),'Automatic penalty has no published-rule match');
  if(actor.expectedCopy)assert(c.copyEvidence.some(e=>e.ruleId===SYSTEM_TEST_RULE&&e.classification==='PROTECTED_CANDIDATE'),'Synthetic protected copy did not produce deterministic evidence');
  const p=board.participants.find(p=>p.alias===actor.alias),detail=await ok(admin,route+state.competitionId+'/participants/'+p.id);
  assert(detail.historyAvailable&&detail.attempts.length===actor.history.length,'Closed organizer history missing');
  assert(detail.wallet.confirmedUsed===sum&&detail.evaluation?.source==='AI_REVIEWER'&&detail.evaluation.penalty===c.decision.penalty,'Individual organizer audit differs from system decision');
  state.observations.individualDetails??=[];state.observations.individualDetails.push({alias:actor.alias,detail});
 }
 save();
}
async function databaseAudit(){
 const {Pool}=require('pg'),core=require('@prompt-battle/core'),sdk=require('@prompt-battle/openrouter');
 assert(process.env.DATABASE_URL,'Configured database connection unavailable');
 const pool=new Pool({connectionString:process.env.DATABASE_URL}),db=await pool.connect(),checks=[],warnings=[];
 const check=(value,name,detail)=>{checks.push({name,passed:!!value,detail});assert(value,name+': '+detail);};
 try{
  await db.query('BEGIN TRANSACTION READ ONLY');await db.query('SET LOCAL search_path TO battle');
  const query=async(sql)=> (await db.query(sql,[state.competitionId])).rows;
  const c=(await query('SELECT c.*,m.manifest FROM competitions c JOIN competition_rules_versions m ON m.id=c.rules_version_id WHERE c.id=$1'))[0];
  check(c.title===state.title&&c.title.startsWith('SYSTEM TEST'),'ISOLATED_TEST_ROUND','Refuse non-test competition');
  const people=await query('SELECT p.*,u.alias,t.allowance,t.consumed,t.reserved,t.state AS account_state FROM participants p JOIN users u ON u.id=p.user_id JOIN token_accounts t ON t.participant_id=p.id WHERE p.competition_id=$1');
  const attempts=await query('SELECT a.*,m.manifest,r.answer,r.answer_hash,r.created_at AS received_at FROM attempts a JOIN competition_rules_versions m ON m.id=a.rules_version_id LEFT JOIN responses r ON r.attempt_id=a.id WHERE a.competition_id=$1 ORDER BY a.version');
  const selections=await query('SELECT f.*,s.id AS submission_id,s.status,s.effective_decision_id,s.published_score_id,sc.decision_id AS score_decision_id,sc.score,st.* FROM final_selections f JOIN submission_states s ON s.selection_id=f.id LEFT JOIN score_revisions sc ON sc.id=s.published_score_id LEFT JOIN solving_timings st ON st.selection_id=f.id WHERE f.competition_id=$1');
  const calls=await query('SELECT pc.*,a.participant_id FROM provider_calls pc LEFT JOIN attempts a ON a.id=pc.attempt_id LEFT JOIN evaluation_runs er ON er.id=pc.evaluation_run_id WHERE a.competition_id=$1 OR er.competition_id=$1');
  const receipts=await query('SELECT pr.* FROM provider_usage_receipts pr JOIN provider_calls pc ON pc.id=pr.provider_call_id LEFT JOIN attempts a ON a.id=pc.attempt_id LEFT JOIN evaluation_runs er ON er.id=pc.evaluation_run_id WHERE a.competition_id=$1 OR er.competition_id=$1');
  const ledger=await query('SELECT l.* FROM token_ledger_events l JOIN participants p ON p.id=l.participant_id WHERE p.competition_id=$1');
  const decisions=await query('SELECT d.* FROM policy_reviews d JOIN final_selections f ON f.id=d.selection_id WHERE f.competition_id=$1');
  const reports=await query('SELECT ir.* FROM integrity_reports ir JOIN final_selections f ON f.id=ir.selection_id WHERE f.competition_id=$1');
  const appeals=await query('SELECT a.* FROM appeals a JOIN final_selections f ON f.id=a.selection_id WHERE f.competition_id=$1');
  const versions=await query('SELECT * FROM problem_versions WHERE competition_id=$1');
  const humanGrades=await query('SELECT h.* FROM quality_human_reviews h JOIN final_selections f ON f.id=h.selection_id WHERE f.competition_id=$1');
  check(people.length===10&&attempts.length===11&&calls.filter(x=>x.purpose==='GENERATION').length===11,'TEN_ACTORS_ELEVEN_GENERATIONS','One extra branch; no unintended repeated paid generations');
  check(humanGrades.length===0&&decisions.every(d=>d.actor_id===null&&d.mode==='AUTOMATIC_REVIEWER'),'NO_HUMAN_SCORING','Every policy/quality decision must be automatic');
  check(appeals.length===1&&appeals[0].status==='RESOLVED'&&appeals[0].resolution_id,'AUTOMATIC_APPEAL','Append an automatically resolved appeal');
  check(reports.length>=11&&reports.some(r=>r.appeal_id===state.appealId&&r.review_revision>1),'APPENDED_REVIEW_REVISION','Retain original and automatic appeal report');
  let totalTokens=0,organizerTokens=0,knownCost=0;
  for(const receipt of receipts){
   const raw=receipt.raw_receipt,norm=raw?.data?sdk.normalizeRecoveryUsage(raw.data):sdk.normalizeCompletionUsage(raw?.usage);
   check(norm.inputTokens===Number(receipt.input_tokens)&&norm.outputTokens===Number(receipt.output_tokens)&&norm.totalTokens===Number(receipt.total_tokens),'NORMALIZED_PROVIDER_RECEIPT',receipt.provider_call_id);
   const call=calls.find(x=>x.id===receipt.provider_call_id);
   if(call.purpose==='GENERATION')totalTokens+=Number(receipt.total_tokens);else organizerTokens+=Number(receipt.total_tokens);
   if(receipt.cost_usd!=null)knownCost+=Number(receipt.cost_usd);
  }
  for(const p of people){
   const ids=new Set(calls.filter(x=>x.purpose==='GENERATION'&&x.participant_id===p.id).map(x=>x.id));
   const sum=receipts.filter(x=>ids.has(x.provider_call_id)).reduce((s,x)=>s+Number(x.total_tokens),0),events=ledger.filter(x=>x.participant_id===p.id);
   check(sum===Number(p.consumed)&&Number(p.reserved)===0&&Number(p.allowance)===2000000,'RECEIPT_WALLET_BALANCE',p.alias);
   check(events.reduce((s,x)=>s+Number(x.consumed_delta),0)===sum&&events.reduce((s,x)=>s+Number(x.reserved_delta),0)===0&&events.every(x=>!x.provider_call_id||ids.has(x.provider_call_id)),'PARTICIPANT_LEDGER_BALANCE',p.alias);
   const f=selections.find(x=>x.participant_id===p.id),a=attempts.find(x=>x.id===f.attempt_id),problem=versions.find(x=>x.version_id===a.manifest.problemVersionId)?.content;
   check(f.score_decision_id===f.effective_decision_id&&f.status==='FINALIZED'&&f.score.tokenUsage===sum,'CURRENT_PUBLISHED_SCORE',p.alias);
   check(problem&&f.score.problemVersionId===a.manifest.problemVersionId&&f.problem_version_id===a.manifest.problemVersionId,'PINNED_ORIGINAL_TESTS',p.alias);
   const deterministic=core.evaluateAnswer(a.answer,problem);
   check(deterministic.C===f.score.correctness&&deterministic.K===f.score.critical&&deterministic.eligible===f.score.eligible,'ORIGINAL_DETERMINISTIC_GRADING',p.alias);
   const correct=attempts.filter(x=>x.participant_id===p.id&&x.manifest.problemVersionId===a.manifest.problemVersionId&&x.answer&&(()=>{const e=core.evaluateAnswer(x.answer,problem);return e.eligible&&e.C===1&&e.K===1;})()).sort((x,y)=>new Date(x.received_at)-new Date(y.received_at))[0];
   const expectedTime=deterministic.eligible&&correct?Math.floor(new Date(correct.received_at)-new Date(a.manifest.competitionStartedAt)):null;
   check((f.elapsed_ms==null?null:Number(f.elapsed_ms))===expectedTime&&(f.first_correct_attempt_id||null)===(expectedTime==null?null:correct.id),'SERVER_FIRST_FULLY_CORRECT_TIMING',p.alias);
   const d=decisions.find(x=>x.id===f.effective_decision_id),calculated=core.calculateScore({C:deterministic.C,K:deterministic.K,J:f.score.judge,T:sum,eligible:deterministic.eligible,reviewedCopyingPenaltyPoints:d.penalty});
   check(calculated.finalScoreExact===f.score.finalScoreExact&&f.score.copyingPenalty===d.penalty,'SCORE_ARITHMETIC',p.alias);
   if(a.prompt.includes('negative control')&&deterministic.eligible)warnings.push({alias:p.alias,message:'The generation model corrected this deliberately wrong/malformed control; that negative live case was not exercised.'});
  }
  const p10=people.find(p=>p.alias==='participant10'),branch=attempts.find(a=>a.participant_id===p10.id&&a.version===2),parent=attempts.find(a=>a.participant_id===p10.id&&a.version===1);
  check(branch.parent_attempt_id===parent.id&&branch.manifest.problemVersionId!==parent.manifest.problemVersionId,'BRANCH_ACROSS_LIVE_REVISION','Restoring an old prompt creates a new version and keeps all old usage');
  check(c.manifest.problemVersionId===state.closedRevisionId&&selections.every(f=>f.score.problemVersionId!==state.closedRevisionId),'CLOSED_EDIT_PRESERVES_FINALS','Latest closed task revision does not alter selected answer evaluations');
  const rows=people.map(p=>{const f=selections.find(x=>x.participant_id===p.id);return {alias:p.alias,score:f.score,tokens:Number(p.consumed),elapsed:f.elapsed_ms==null?Infinity:Number(f.elapsed_ms)};});
  const exact=(a,b)=>{const [ai,af='']=String(a).split('.'),[bi,bf='']=String(b).split('.'),w=Math.max(af.length,bf.length),x=BigInt(ai+af.padEnd(w,'0')),y=BigInt(bi+bf.padEnd(w,'0'));return x<y?-1:x>y?1:0;};
  rows.sort((a,b)=>Number(b.score.eligible)-Number(a.score.eligible)||exact(b.score.finalScoreExact,a.score.finalScoreExact)||(a.score.eligible?(a.elapsed<b.elapsed?-1:a.elapsed>b.elapsed?1:0):0)||b.score.quality-a.score.quality||b.score.correctness-a.score.correctness||a.tokens-b.tokens);
  check(rows.map(x=>x.alias).join('|')===state.observations.leaderboard.rows.map(x=>x.alias).join('|'),'LIVE_RANKING_ORDER','Independent exact-score comparison followed by earlier fully correct completion');
  const tiePairs=rows.filter((r,i)=>i&&r.score.eligible&&rows[i-1].score.eligible&&r.score.finalScoreExact===rows[i-1].score.finalScoreExact).length;
  if(!tiePairs)warnings.push({message:'Live model scores contained no exact score tie; equal-score timing precedence is covered by the dedicated automated comparator regression.'});
  state.audit={ok:true,checks,warnings,summary:{participantCount:people.length,generationRequests:11,generationTokens:totalTokens,organizerEvaluationTokens:organizerTokens,reportedKnownCostUsd:knownCost,automaticDecisions:decisions.length,reviewReports:reports.length,problemRevisions:versions.length,liveEqualScorePairs:tiePairs}};
  fs.writeFileSync(path.join(dir,'audit.json'),JSON.stringify(state.audit,null,2));
  await db.query('ROLLBACK');
 }catch(e){state.audit={ok:false,checks,warnings,failure:e.message};fs.writeFileSync(path.join(dir,'audit.json'),JSON.stringify(state.audit,null,2));throw e;}finally{db.release();await pool.end();}
}
try{
 await step('Organizer real Chrome login',()=>login(admin,'organizer'));
 if(!state.competitionId){
  const created=await step('Create isolated automatic competition',()=>ok(admin,route.slice(0,-1),'POST',{title:state.title}));
  state.competitionId=created.competition.id;save();
 }
 let board=await ok(admin,route+state.competitionId);
 assert(board.competition.title===state.title&&state.title.startsWith('SYSTEM TEST'),'Refusing to modify a non-test competition');
 if(board.competition.status==='DRAFT'){
  const first=await step('Add validated original problem',()=>ok(admin,route+state.competitionId+'/problem','POST',testDraft()));
  board=await ok(admin,route+state.competitionId);
  const protectedItem={id:crypto.randomUUID(),category:'PROTECTED_CRITICAL_INFORMATION',text:SYSTEM_TEST_PROTECTED_COMMENTARY,publicRuleId:SYSTEM_TEST_RULE,severity:'MINOR',explanation:'Nonessential synthetic commentary; automatic reviewer assesses reproduction under published MINOR schedule. Necessary facts remain allowed.'};
  await ok(admin,route+state.competitionId+'/critical-registry/versions','POST',{items:[...board.registry.items.filter(i=>i.publicRuleId!==SYSTEM_TEST_RULE),protectedItem]});
  const now=Date.now();await ok(admin,route+state.competitionId+'/schedule','POST',{generationCutoff:new Date(now+3600000).toISOString(),selectionCutoff:new Date(now+5400000).toISOString(),revealAt:new Date(now+5400000).toISOString()});
  await step('Publish automatic review and timing rules',()=>ok(admin,route+state.competitionId+'/start','POST',{}));
  state.originalRevisionId=first.versionId;save();
 }
 if(!state.actors.length)state.actors=SYSTEM_TEST_SCENARIOS.map((s,i)=>({...s,session:'auto-p'+(i+1)+'-'+suffix,attempts:[],submissionId:null}));save();
 await step('Ten independent real participant logins',()=>mapLimit(state.actors,2,async a=>{await login(a.session,a.alias);await join(a.session);}));
 if(!state.firstGenerationsComplete){
  await step('Ten exact synthetic prompts generate original-version answers',()=>mapLimit(state.actors,4,async a=>{const result=await recoverOrGenerate(a,0,a.prompts[0]);noLiveHints(result);a.attempts=[result];save();log(a.alias+' received '+result.totalTokens+' tokens');}));
  state.firstGenerationsComplete=true;save();
 }
 board=await ok(admin,route+state.competitionId);
 assert(board.participants.length===10,'Organizer lost enrolled actors');
 if(!state.closureEpoch){assert(board.cases.length===0,'Live organizer view exposes integrity review');const liveBoard=await ok(admin,'/competitions/'+state.competitionId+'/leaderboard');assert(liveBoard.rows.every(r=>r.score===null&&r.copyingPenalty==null),'Live leaderboard revealed private score/penalty');}
 const p2=board.participants.find(p=>p.alias==='participant2');assert((await api(state.actors[0].session,route+state.competitionId+'/participants/'+p2.id)).status===403,'Participant accessed private organizer detail');
 if(!state.liveRevisionId){
  const revised=await step('Edit live task to56 without changing earlier answers',()=>ok(admin,route+state.competitionId+'/problem','POST',testDraft(8)));state.liveRevisionId=revised.versionId;save();
 }
 const actor10=state.actors[9],newPrompt=SYSTEM_TEST_SCENARIOS[9].prompts[1].replace('six multiplied by seven','eight multiplied by seven');
 if(actor10.attempts.length<2){
  await restoreBranch(actor10);
  actor10.attempts.push(await step('Restore original prompt and generate new-revision branch',()=>recoverOrGenerate(actor10,1,newPrompt)));save();
 }
 for(const a of state.actors){const h=(await ok(a.session,'/competitions/'+state.competitionId+'/attempts')).attempts;assert(h[0].problemVersionId===state.originalRevisionId&&h[0].prompt===a.prompts[0]&&h[0].answer===a.attempts[0].answer,'Live edit changed original immutable history');}
 assert(actor10.attempts[1].problemVersionId===state.liveRevisionId,'New attempt did not receive the new task');
 await step('Lock ten final answers through real browser controls',()=>mapLimit(state.actors,2,async a=>{
  const current=await ok(a.session,'/competitions/'+state.competitionId);
  const selected=a.alias==='participant10'?a.attempts[1]:a.attempts[0];a.selectedAttemptId=selected.id;
  if(!a.submissionId)a.submissionId=current.submissionId||await choose(a.session,selected);save();
 }));
 if(!state.closureEpoch){const closed=await step('Competition-wide closure starts automatic integrity evaluation',()=>ok(admin,route+state.competitionId+'/close','POST',{}));state.closureEpoch=closed.closureEpoch;save();}
 if(!state.closedRevisionId){const revised=await step('Edit closed task to63 while preserving selected grading',()=>ok(admin,route+state.competitionId+'/problem','POST',testDraft(9)));state.closedRevisionId=revised.versionId;save();}
 board=await step('Wait for ten model decisions and scores without human sign-off',waitFinalized);
 state.observations.preRevealDashboard=board;save();
 const manual=await api(admin,'/organizer/submissions/'+state.actors[0].submissionId+'/reviews','POST',{verdict:'NO_VIOLATION',reason:'Synthetic test probes manual scoring prohibition.',severity:'NONE'},crypto.randomUUID());
 assert(manual.status===409&&/automatic/i.test(JSON.stringify(manual.body)),'Manual copying decision was not prohibited');
 board=await ok(admin,route+state.competitionId);
 if(!['REVEALED','CALIBRATION_REVEALED'].includes(board.competition.status))await step('Reveal ten automatically finalized results',()=>ok(admin,route+state.competitionId+'/reveal','POST',{}));
 if(!state.appealId){
  const a=state.actors[3];
  const appeal=await step('Participant requests automatic frozen-rule appeal',()=>ok(a.session,'/submissions/'+a.submissionId+'/appeals','POST',{reason:'Synthetic QA appeal: reassess the immutable selected prompt against its original designated protected passage. Keep the frozen public rule and all necessary-fact exceptions.'},crypto.randomUUID()));
  state.appealId=appeal.appealId;save();
  const pending=await ok(a.session,'/submissions/'+a.submissionId);state.observations.immediateAppeal=pending;
  // A completed fast review may already show its new score; pending review must hide the old one.
  assert(pending.status==='FINALIZED'||pending.score===null,'Pending appeal exposed an old score');save();
 }
 await step('Automatic appeal resolves without manual intervention',async()=>{
  for(let i=0;i<240;i++){const b=await ok(admin,route+state.competitionId),c=b.cases.find(c=>c.alias===state.actors[3].alias);if(c?.status==='FINALIZED'&&c.decision?.source==='AI_REVIEWER'&&!c.appeal)return;await sleep(1000);}throw Error('Automatic appeal remains pending; original decisions retained');
 });
 await step('Inspect individual organizer and participant audit views',browserAudit);
 await step('Reconcile receipts, ledger, automatic decisions, original tests, timing and ranking',databaseAudit);
 state.status='AUTOMATIC_BROWSER_WORKFLOW_PASSED';delete state.failure;save();log('Automatic ten-actor test passed: '+dir);log(JSON.stringify(state.audit.summary));
}catch(error){state.status='FAILED_OR_PENDING';state.failure=error.message;save();log('FAILED/PENDING: '+error.message);process.exitCode=1;}
