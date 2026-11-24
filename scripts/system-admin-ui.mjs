import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {buildSystemTestProblemDraft,SYSTEM_TEST_TITLE_PREFIX,SYSTEM_TEST_RULE,SYSTEM_TEST_PROTECTED_COMMENTARY,SYSTEM_TEST_SCENARIOS} from './system-test-fixtures.mjs';
const run=promisify(execFile),root=process.cwd(),origin='http://localhost:3000';
const npx=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npx-cli.js');
if(!fs.existsSync(npx))throw new Error('npx runtime unavailable');
if(!process.argv.includes('--local-ui'))throw new Error('Pass --local-ui for isolated organizer controls.');
const resumeArg=process.argv.indexOf('--resume-setup');
const resumeDir=resumeArg>=0?path.resolve(process.argv[resumeArg+1]||''):null;
if(resumeDir&&!resumeDir.startsWith(path.join(root,'.local/system-tests')+path.sep))throw new Error('Resume directory outside isolated test area');
const previous=resumeDir?JSON.parse(fs.readFileSync(path.join(resumeDir,'run.json'),'utf8')):null;
if(previous&&(previous.actors.some(a=>a.attempts?.length)||!previous.steps.some(s=>s.name==='Publish frozen system-test rules')))throw new Error('Setup resume only supports a published round before paid generations');
const runId=previous?.runId||new Date().toISOString().replace(/[:.]/g,'-'),dir=resumeDir||path.join(root,'.local/system-tests',runId);
fs.mkdirSync(dir,{recursive:true});
const state=previous||{runId,title:SYSTEM_TEST_TITLE_PREFIX+' · Admin UI controls · '+runId,competitionId:null,steps:[],actors:[],observations:{announcementAccess:[]},expectedGenerationRequests:11,expectedMinimumTotalProviderRequests:41,status:'RUNNING'};
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
const admin='system-admin-controls';
function result(r){return typeof r.result==='string'?JSON.parse(r.result):r.result;}
async function selectField(name,value){const n=await target(admin,'combobox',name);await cli(admin,'select',[n.ref,value]);}
async function shot(name){fs.mkdirSync(path.join(root,'output/playwright'),{recursive:true});await cli(admin,'run-code',['async(page)=>{await page.screenshot({path:'+JSON.stringify(path.join(root,'output/playwright',name))+',fullPage:false});return {captured:true};}'],true);}
try{
 await step('Organizer signs in through UI',()=>login(admin,'organizer'));
 await click(admin,'button','Competitions');await click(admin,'button','New competition');
 await fill(admin,'Competition title',state.title);await click(admin,'button','Create draft');
 const selected=result(await cli(admin,'run-code',['async(page)=>({id:await page.getByRole("combobox",{name:"Current competition",exact:true}).inputValue()})'],true));
 state.competitionId=selected.id;const board=await ok(admin,'/organizer/competitions/'+state.competitionId);assert(board.competition.title===state.title,'Wrong UI draft');save();
 await click(admin,'button','Organizer');await click(admin,'button','Problem');
 await click(admin,'button','Replace with custom structured problem');
 const draft=buildSystemTestProblemDraft();
 await fill(admin,'Public problem title',draft.title+' · UI');
 await fill(admin,'Public problem statement · your original text',draft.statement);
 await fill(admin,'Public objectives · one per line',draft.objectives.join('\n'));
 await fill(admin,'Public constraints · one per line',draft.constraints.join('\n'));
 for(let i=0;i<2;i++){
  const n=i+1,req=draft.requirements[i];await click(admin,'button','Add requirement');
  await fill(admin,'Requirement ID '+n,req.id);await fill(admin,'Requirement text '+n,req.text);await selectField('Requirement group '+n,req.group);
 }
 for(let i=0;i<2;i++){
  const n=i+1,c=draft.checks[i];await click(admin,'button','Add check');
  await fill(admin,'Check ID '+n,c.id);await fill(admin,'Check name '+n,c.name);await selectField('Check requirement '+n,c.requirementId);
  await fill(admin,'Check path '+n,c.path);await selectField('Check operator '+n,c.operator);await selectField('Check visibility '+n,c.visibility);await fill(admin,'Check expected JSON '+n,JSON.stringify(c.expected));
 }
 await fill(admin,'Private reference JSON',JSON.stringify(draft.referenceAnswer,null,2));
 await step('Save manually authored structured problem through UI',()=>click(admin,'button','Save and validate problem'));
 let first;for(let i=0;i<15;i++){first=await ok(admin,'/organizer/competitions/'+state.competitionId+'/problem');if(first.problemKind==='STRUCTURED_JSON')break;await new Promise(r=>setTimeout(r,500));}
 assert(first.draft.statement===draft.statement,'Multiline UI statement lost');await shot('admin-problem-editor.png');
 await fill(admin,'Public problem title',draft.title+' · UI edited');await step('Edit problem through UI',()=>click(admin,'button','Save and validate problem'));
 let edited;for(let i=0;i<15;i++){edited=await ok(admin,'/organizer/competitions/'+state.competitionId+'/problem');if(edited.versionId!==first.versionId)break;await new Promise(r=>setTimeout(r,500));}assert(edited.versionId!==first.versionId,'Edit not versioned');
 await click(admin,'button','Remove draft problem');await step('Remove draft problem through confirmation',()=>click(admin,'button','Confirm draft removal'));
 for(let i=0;i<15;i++){const gone=await ok(admin,'/organizer/competitions/'+state.competitionId+'/problem');if(gone.deleted)break;if(i===14)throw new Error('Removal not stored');await new Promise(r=>setTimeout(r,500));}
 await click(admin,'button','Overview');const publish=await target(admin,'button','Publish competition');assert(publish.disabled,'Deleted problem could publish in UI');
 await click(admin,'button','Problem');await fill(admin,'Public problem title',draft.title+' · UI restored');await step('Restore retained form through UI save',()=>click(admin,'button','Save and validate problem'));
 let restored;for(let i=0;i<15;i++){restored=await ok(admin,'/organizer/competitions/'+state.competitionId+'/problem');if(!restored.deleted&&restored.versionId!==edited.versionId)break;await new Promise(r=>setTimeout(r,500));}assert(!restored.deleted&&restored.versionId!==edited.versionId,'Restore not versioned');
 await click(admin,'button','Administration');await fill(admin,'Title · optional','SYSTEM TEST UI notice');
 const message='First logistics line.\nSecond logistics line. Literal markup: <b>do not execute</b>.';
 await fill(admin,'Message to competition members',message);await step('Publish multiline announcement through UI',()=>click(admin,'button','Publish announcement'));
 let notices;for(let i=0;i<15;i++){notices=await ok(admin,'/organizer/competitions/'+state.competitionId+'/announcements');if(notices.announcements.length)break;await new Promise(r=>setTimeout(r,500));}assert(notices.announcements.at(-1).message.includes(message),'Announcement content lost');await shot('admin-announcements.png');
 await click(admin,'button','Withdraw');await step('Withdraw announcement through UI confirmation',()=>click(admin,'button','Confirm withdrawal'));
 const done=await ok(admin,'/organizer/competitions/'+state.competitionId+'/announcements');assert(done.announcements[0].withdrawn,'UI withdrawal not stored');
 state.status='ADMIN_UI_PASSED';save();log('Organizer UI controls passed');
}catch(e){state.status='FAILED_OR_PENDING';state.failure=e.message;save();log('UI TEST FAILED: '+e.message);process.exitCode=1;}