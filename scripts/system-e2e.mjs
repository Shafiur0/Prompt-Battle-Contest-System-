import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {buildSystemTestProblemDraft,SYSTEM_TEST_TITLE_PREFIX,SYSTEM_TEST_RULE,SYSTEM_TEST_PROTECTED_COMMENTARY,SYSTEM_TEST_SCENARIOS} from './system-test-fixtures.mjs';
const run=promisify(execFile),root=process.cwd(),origin='http://localhost:3000';
const npx=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npx-cli.js');
if(!fs.existsSync(npx))throw new Error('npx runtime unavailable');
if(!process.argv.includes('--live-ai'))throw new Error('This test makes paid model calls. Pass --live-ai explicitly.');
const resumeArg=process.argv.indexOf('--resume-setup');
const resumeDir=resumeArg>=0?path.resolve(process.argv[resumeArg+1]||''):null;
if(resumeDir&&!resumeDir.startsWith(path.join(root,'.local/system-tests')+path.sep))throw new Error('Resume directory outside isolated test area');
const previous=resumeDir?JSON.parse(fs.readFileSync(path.join(resumeDir,'run.json'),'utf8')):null;
if(previous&&(previous.actors.some(a=>a.attempts?.length)||!previous.steps.some(s=>s.name==='Publish frozen system-test rules')))throw new Error('Setup resume only supports a published round before paid generations');
const runId=previous?.runId||new Date().toISOString().replace(/[:.]/g,'-'),dir=resumeDir||path.join(root,'.local/system-tests',runId);
fs.mkdirSync(dir,{recursive:true});
const state=previous||{runId,title:SYSTEM_TEST_TITLE_PREFIX+' · Ten participant exercise · '+runId,competitionId:null,steps:[],actors:[],observations:{announcementAccess:[]},expectedGenerationRequests:11,expectedMinimumTotalProviderRequests:41,status:'RUNNING'};
state.expectedGenerationRequests=11;state.expectedMinimumTotalProviderRequests=41;delete state.paidRequestsExpected;
function save(){fs.writeFileSync(path.join(dir,'run.json'),JSON.stringify(state,null,2));}
function log(message){console.log(new Date().toISOString()+' '+message);}
function assert(value,message){if(!value)throw new Error(message);}
function scrub(text){return text.replaceAll('local-participant-change-me','[LOCAL FIXTURE PASSWORD]').replaceAll('local-organizer-change-me','[LOCAL FIXTURE PASSWORD]');}
async function cli(session,command,args=[],json=false){
 const argv=[npx,'--yes','--package','@playwright/cli','playwright-cli','-s='+session,command,...args,...(json?['--json']:[])];
 try{const r=await run(process.execPath,argv,{cwd:root,timeout:120000,maxBuffer:16*1024*1024});fs.appendFileSync(path.join(dir,'cli.log'),scrub(r.stdout+r.stderr)+'\n');if(!json)return r.stdout;const start=r.stdout.indexOf('{');if(start<0)throw new Error('Missing JSON CLI response');return JSON.parse(r.stdout.slice(start));}
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
 await cli(session,'open',[origin,'--browser=chrome','--idle-timeout=0']);
 const existing=await api(session,'/session');if(existing.body.authenticated&&existing.body.user?.alias===alias)return;
 await click(session,'link','Sign in');
 await fill(session,'Username or email',alias);
 await fill(session,'Password',alias==='organizer'?'local-organizer-change-me':'local-participant-change-me');
 await click(session,'button','Sign In');
 for(let i=0;i<20;i++){const r=await api(session,'/session');if(r.body.authenticated){assert(r.body.user.alias===alias,'Incorrect actor identity');return;}await new Promise(r=>setTimeout(r,500));}
 throw new Error('Actor login did not finish: '+alias);
}
async function workspace(session){
 const nodes=await snapshot(session),select=flatten(nodes).find(n=>n.role==='combobox'&&n.name==='Current competition');
 if(select)await cli(session,'select',[select.ref,state.competitionId]);
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
const admin='system-admin';
try{
 await step('Organizer browser login',()=>login(admin,'organizer'));
 if(!previous){
 const created=await step('Create dedicated system-test draft',()=>ok(admin,'/organizer/competitions','POST',{title:state.title}));
 state.competitionId=created.competition.id;assert(/^[a-f0-9-]{36}$/i.test(state.competitionId),'Invalid test competition id');save();
 const draft=buildSystemTestProblemDraft();
 const first=await step('Add problem and validated private reference',()=>ok(admin,'/organizer/competitions/'+state.competitionId+'/problem','POST',draft));
 const edited=await step('Edit draft problem and preserve version history',()=>ok(admin,'/organizer/competitions/'+state.competitionId+'/problem','POST',{...draft,title:draft.title+' · reviewed'}));
 assert(first.versionId!==edited.versionId,'Problem edit did not version');
 await step('Logical draft problem deletion',()=>ok(admin,'/organizer/competitions/'+state.competitionId+'/problem','DELETE',{}));
 const removed=await ok(admin,'/organizer/competitions/'+state.competitionId+'/problem');assert(removed.deleted===true&&removed.problemKind==='NONE','Draft problem was not removed');
 const denied=await api(admin,'/organizer/competitions/'+state.competitionId+'/start','POST',{});assert(denied.status===409,'Deleted problem could publish');
 await step('Restore new active problem version',()=>ok(admin,'/organizer/competitions/'+state.competitionId+'/problem','POST',draft));
 let board=await ok(admin,'/organizer/competitions/'+state.competitionId);
 const protectedItem={id:crypto.randomUUID(),category:'PROTECTED_CRITICAL_INFORMATION',text:SYSTEM_TEST_PROTECTED_COMMENTARY,publicRuleId:SYSTEM_TEST_RULE,severity:'MINOR',explanation:'Nonessential public test commentary; direct reproduction requires human review. Necessary mathematical facts are reusable.'};
 await step('Configure explicit protected source passage',()=>ok(admin,'/organizer/competitions/'+state.competitionId+'/critical-registry/versions','POST',{items:[...board.registry.items,protectedItem]}));
 const now=Date.now();await ok(admin,'/organizer/competitions/'+state.competitionId+'/schedule','POST',{generationCutoff:new Date(now+3600000).toISOString(),selectionCutoff:new Date(now+5400000).toISOString(),revealAt:new Date(now+5400000).toISOString()});
 await step('Publish frozen system-test rules',()=>ok(admin,'/organizer/competitions/'+state.competitionId+'/start','POST',{}));
 for(const method of ['POST','DELETE']){const r=await api(admin,'/organizer/competitions/'+state.competitionId+'/problem',method,method==='POST'?draft:{});assert(r.status===409,'Published problem modification was allowed');}
 }
 let board;
 state.actors=SYSTEM_TEST_SCENARIOS.map((scenario,i)=>({...scenario,session:'system-p'+(i+1),attempts:[],submissionId:null}));save();
 await step('Ten independent participant browser logins/enrollments',()=>mapLimit(state.actors,2,async actor=>{await login(actor.session,actor.alias);await join(actor.session);log(actor.alias+' enrolled with real identity and 2,000,000 allowance');}));
 board=await ok(admin,'/organizer/competitions/'+state.competitionId);assert(board.participants.length===10,'Admin did not see ten members');
 const announce=await step('Administrator publishes operational announcement',()=>ok(admin,'/organizer/competitions/'+state.competitionId+'/announcements','POST',{message:'SYSTEM TEST notice: use the published task and manually authored prompts. Grading rules are unchanged.'}));
 const announcementList=await ok(admin,'/organizer/competitions/'+state.competitionId+'/announcements');const announcementId=announce.id||announce.announcement?.id||announce.announcementId||announcementList.announcements.at(-1)?.id;assert(announcementId,'Announcement id missing');
 for(const actor of state.actors){const r=await api(actor.session,'/competitions/'+state.competitionId+'/announcements');assert(r.status===200&&r.body.announcements.some(a=>a.id===announcementId),'Announcement not visible to '+actor.alias);state.observations.announcementAccess.push({alias:actor.alias,httpStatus:r.status,observedAt:new Date().toISOString(),visibleIds:r.body.announcements.map(a=>a.id)});}
 const a1=state.actors[0],p2=board.participants.find(p=>p.alias==='participant2');
 assert((await api(a1.session,'/organizer/competitions/'+state.competitionId+'/announcements','POST',{message:'Unauthorized test'})).status===403,'Participant created announcement');
 assert((await api(a1.session,'/organizer/competitions/'+state.competitionId+'/participants/'+p2.id)).status===403,'Participant read admin detail');
 await step('Ten participants generate real model answers',()=>mapLimit(state.actors,10,async actor=>{const attempt=await generation(actor.session,actor.prompts[0]);actor.attempts.push(attempt);log(actor.alias+' answer received; '+attempt.totalTokens+' provider tokens');save();}));
 board=await ok(admin,'/organizer/competitions/'+state.competitionId);
 for(const p of board.participants){const detail=await ok(admin,'/organizer/competitions/'+state.competitionId+'/participants/'+p.id);assert(detail.historyAvailable===false,'Active prompts exposed to admin status view');assert(!detail.attempts.some(a=>a.prompt||a.answer),'Active detail leaked prompt/answer');}
 const p10=board.participants.find(p=>p.alias==='participant10'),actor10=state.actors[9],walletBefore=await ok(actor10.session,'/competitions/'+state.competitionId+'/token-account');
 await step('Human admin ban prevents writes without refunds',()=>ok(admin,'/organizer/competitions/'+state.competitionId+'/participants/'+p10.id+'/ban','POST',{reason:'Synthetic QA: verify competition-scoped access suspension.',publicNotice:'Your test access is temporarily suspended by the organizer.',confirmedFinding:'Administrator manually reviewed this synthetic moderation-control case.'}));
 assert([403,409].includes((await api(actor10.session,'/competitions/'+state.competitionId+'/attempts','POST',{prompt:actor10.prompts[1]},crypto.randomUUID())).status),'Banned actor could generate');
 assert([403,409].includes((await api(actor10.session,'/competitions/'+state.competitionId+'/final-selections','POST',{attemptId:actor10.attempts[0].id},crypto.randomUUID())).status),'Banned actor could select');
 const walletBanned=await ok(actor10.session,'/competitions/'+state.competitionId+'/token-account');assert(walletBanned.confirmedUsed===walletBefore.confirmedUsed&&walletBanned.reserved===walletBefore.reserved,'Ban altered token usage');
 await step('Human admin unban keeps immutable history',()=>ok(admin,'/organizer/competitions/'+state.competitionId+'/participants/'+p10.id+'/unban','POST',{reason:'Synthetic QA moderation-control completed.',publicNotice:'Test access restored.'}));
 actor10.attempts.push(await generation(actor10.session,actor10.prompts[1]));save();
 await step('All ten final selections through browser controls',()=>mapLimit(state.actors,2,async actor=>{let attempt=actor.attempts.at(-1);if(actor.alias==='participant10'){try{if(JSON.parse(actor.attempts[0].answer).result===42)attempt=actor.attempts[0];}catch{}}actor.selectedAttemptId=attempt.id;actor.submissionId=await choose(actor.session,attempt);save();}));
 const foreign=state.actors[1].attempts[0].id;assert([403,404].includes((await api(a1.session,'/attempts/'+foreign)).status),'Another actor answer was accessible');
 const forged=await api(a1.session,'/competitions/'+state.competitionId+'/attempts','POST',{prompt:'Synthetic tamper probe',inputTokens:0,score:100,answer:'fake'},crypto.randomUUID());assert(forged.status===400,'Fake frontend scoring/usage fields were accepted');
 await step('Withdraw announcement retains operational history',()=>ok(admin,'/organizer/competitions/'+state.competitionId+'/announcements/'+announcementId,'DELETE',{}));
 assert(!(await ok(a1.session,'/competitions/'+state.competitionId+'/announcements')).announcements.some(a=>a.id===announcementId&&!a.withdrawn),'Withdrawn announcement stayed active');
 await step('Competition-wide closure admits integrity review',()=>ok(admin,'/organizer/competitions/'+state.competitionId+'/close','POST',{}));
 for(let i=0;i<240;i++){
  board=await ok(admin,'/organizer/competitions/'+state.competitionId);
  if(board.cases.length===10&&board.cases.every(c=>c.review||c.humanFallbackAvailable)&&board.cases.every(c=>c.solutionEvaluation))break;
  if(i===239)throw new Error('Review results remain pending; no fabricated fallback was supplied');
  await new Promise(r=>setTimeout(r,1000));
 }
 state.observations.preAdjudication=board;save();
 await step('Human quality fallback only when required',async()=>{for(const c of board.cases){if(c.qualityReviewRequired){let rationale='';try{rationale=JSON.parse(c.answer).rationale||'';}catch{}const scores={clarity:rationale?3:0,justification:rationale?2:0,concision:rationale.length<800?4:2};await ok(admin,'/organizer/submissions/'+c.submissionId+'/quality-review','POST',{scores,reason:'Synthetic QA human fallback: inspected the immutable rationale for clarity, justification and concision. Deterministic correctness remains unchanged.'});}}});
 await step('Simulated human adjudication controls every policy result',async()=>{for(const actor of state.actors){const c=board.cases.find(c=>c.alias===actor.alias);assert(c,'Missing final case');const positive=actor.expectedCopy;assert(c.prompt===actor.history?.find(a=>a.id===actor.selectedAttemptId)?.prompt||c.prompt===actor.attempts.find(a=>a.id===actor.selectedAttemptId)?.prompt,'Selected prompt evidence differs');assert(!positive||c.copyEvidence?.some(e=>e.ruleId===SYSTEM_TEST_RULE&&e.classification==='PROTECTED_CANDIDATE'),'Expected copy scenario has no supporting protected evidence');const body={verdict:positive?'CONFIRMED_VIOLATION':'NO_VIOLATION',reason:positive?'Synthetic QA administrator inspected the exact selected passage against the published nonessential reproduction restriction.':'Synthetic QA administrator inspected the selected prompt: necessary public facts and ordinary terminology are permitted; no protected reproduction established.',severity:positive?'MINOR':'NONE',...(positive?{ruleId:SYSTEM_TEST_RULE}:{})};await ok(admin,'/organizer/submissions/'+actor.submissionId+'/reviews','POST',body,crypto.randomUUID());}});
 for(let i=0;i<90;i++){board=await ok(admin,'/organizer/competitions/'+state.competitionId);if(board.cases.every(c=>c.status==='FINALIZED'))break;if(i===89)throw new Error('Finalization is still pending');await new Promise(r=>setTimeout(r,1000));}
 await step('Reveal consistently finalized calibration results',()=>ok(admin,'/organizer/competitions/'+state.competitionId+'/reveal','POST',{}));
 state.observations.firstLeaderboard=await ok(admin,'/competitions/'+state.competitionId+'/leaderboard');
 const appealActor=state.actors[3];
 const appeal=await step('Participant appeal records a challenged human decision',()=>ok(appealActor.session,'/submissions/'+appealActor.submissionId+'/appeals','POST',{reason:'Synthetic QA appeal: request a second inspection of the recorded protected partial-copy finding.'},crypto.randomUUID()));
 await ok(admin,'/organizer/submissions/'+appealActor.submissionId+'/reviews','POST',{verdict:'INSUFFICIENT_EVIDENCE',reason:'Synthetic QA second review pauses the finding while examining the appeal evidence.',severity:'NONE',appealId:appeal.appealId},crypto.randomUUID());
 const pending=await ok(appealActor.session,'/submissions/'+appealActor.submissionId);assert(pending.score===null,'Stale score exposed with unresolved successor decision');
 await ok(admin,'/organizer/submissions/'+appealActor.submissionId+'/reviews','POST',{verdict:'CONFIRMED_VIOLATION',reason:'Synthetic QA second inspection confirms the substantial selected protected excerpt under the unchanged public rule.',ruleId:SYSTEM_TEST_RULE,severity:'MINOR',appealId:appeal.appealId},crypto.randomUUID());
 for(let i=0;i<60;i++){const r=await ok(appealActor.session,'/submissions/'+appealActor.submissionId);if(r.score)break;if(i===59)throw new Error('Appeal score revision pending');await new Promise(r=>setTimeout(r,1000));}
 board=await ok(admin,'/organizer/competitions/'+state.competitionId);
 const guiltyActor=state.actors[1],guilty=board.participants.find(p=>p.alias===guiltyActor.alias);
 await step('Post-finding ban excludes awards while retaining score history',()=>ok(admin,'/organizer/competitions/'+state.competitionId+'/participants/'+guilty.id+'/ban','POST',{reason:'Synthetic QA confirmed published reproduction-rule violation.',publicNotice:'Administrator confirmed a test-round rule violation; this test entry is excluded from awards.',confirmedFinding:'Administrator reviewed the recorded human integrity decision for this synthetic full-copy case.'}));
 const finalBoard=await ok(admin,'/competitions/'+state.competitionId+'/leaderboard');assert(finalBoard.rows.find(r=>r.alias===guiltyActor.alias)?.status==='BANNED','Banned entry not identified');assert(finalBoard.rows.find(r=>r.alias===guiltyActor.alias)?.rank===null,'Banned entry retained award rank');
 state.observations.leaderboard=finalBoard;state.observations.finalDashboard=await ok(admin,'/organizer/competitions/'+state.competitionId);
 for(const actor of state.actors){actor.final=await ok(actor.session,'/submissions/'+actor.submissionId);actor.wallet=await ok(actor.session,'/competitions/'+state.competitionId+'/token-account');actor.history=(await ok(actor.session,'/competitions/'+state.competitionId+'/attempts')).attempts;}
 state.status='BROWSER_WORKFLOW_PASSED';save();log('Ten-actor workflow passed; audit evidence in '+dir);
}catch(error){state.status='FAILED_OR_PENDING';state.failure=error.message;save();log('FAILED/PENDING: '+error.message);process.exitCode=1;}
