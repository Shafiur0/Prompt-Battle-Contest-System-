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
const state=previous||{runId,title:SYSTEM_TEST_TITLE_PREFIX+' · Individual admin UI checks · '+runId,competitionId:null,steps:[],actors:[],observations:{announcementAccess:[]},expectedGenerationRequests:11,expectedMinimumTotalProviderRequests:41,status:'RUNNING'};
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
const admin='system-admin-controls',competition='f8e4dcd0-8ed3-42de-be12-bf61831af96a';
function unwrap(r){return typeof r.result==='string'?JSON.parse(r.result):r.result;}
async function rowButton(alias,name){const nodes=await snapshot(admin);const rows=flatten(nodes).filter(n=>n.role==='row'&&flatten([n]).some(n=>n.text===alias||n.name===alias));assert(rows.length===1,'Individual row missing: '+alias);const b=find(rows[0].children,'button',name);await cli(admin,'click',[b.ref]);}
async function shot(name){fs.mkdirSync(path.join(root,'output/playwright'),{recursive:true});await cli(admin,'run-code',['async(page)=>{await page.screenshot({path:'+JSON.stringify(path.join(root,'output/playwright',name))+',fullPage:false});return true;}'],true);}
try{
 await login(admin,'organizer');state.competitionId=competition;const current=await target(admin,'combobox','Current competition');await cli(admin,'select',[current.ref,competition]);await click(admin,'button','Organizer');await click(admin,'button','Administration');
 const board=await ok(admin,'/organizer/competitions/'+competition);assert(board.participants.length===10,'Ten-person status table missing');
 await step('Inspect all ten participant state drawers',async()=>{for(const p of board.participants){
  await rowButton(p.alias,'Inspect state');await target(admin,'dialog',p.alias+' · Participant details');
  const detail=await ok(admin,'/organizer/competitions/'+competition+'/participants/'+p.id);
  const checked=unwrap(await cli(admin,'run-code',['async(page)=>{const modal=page.getByRole("dialog",{name:'+JSON.stringify(p.alias+' · Participant details')+',exact:true});const text=await modal.innerText();return {allowance:text.includes("2,000,000"),confirmed:text.includes('+JSON.stringify(new Intl.NumberFormat('en-US').format(detail.wallet.confirmedUsed))+'),recorded:text.includes("Recorded"),versions:await modal.getByRole("heading",{name:/^Attempt [0-9]+$/}).count()};}'],true));
  assert(checked.allowance&&checked.confirmed&&checked.recorded&&checked.versions===detail.attempts.length,'UI state did not match server for '+p.alias);
  if(p.alias==='participant10')await shot('admin-individual-participant.png');
  state.observations[p.alias]={wallet:detail.wallet,versions:detail.attempts.length,uiVerified:true};save();await click(admin,'button','Close dialog');
 }});
 const guilty=board.participants.find(p=>p.alias==='participant2');assert(guilty.moderationStatus==='BANNED','Expected confirmed copy entry not banned');
 await rowButton('participant2','Unban');const disabled=await target(admin,'button','Confirm unban');assert(disabled.disabled,'Unban did not require reason/confirmation');
 await fill(admin,'Private human reason','Synthetic UI verification: clear and reapply the already-confirmed test-round moderation decision.');
 let modal=find(await snapshot(admin),'dialog','Unban participant2?');const check=flatten(modal.children).find(n=>n.role==='checkbox');await cli(admin,'check',[check.ref]);
 await step('Unban confirmed synthetic entry through UI',()=>click(admin,'button','Confirm unban'));await click(admin,'button','Refresh server data');
 for(let i=0;i<20;i++){try{await rowButton('participant2','Ban');break;}catch(e){if(i===19)throw e;await new Promise(r=>setTimeout(r,500));}}
 assert((await target(admin,'button','Confirm ban')).disabled,'Ban did not require finding/confirmation');
 await fill(admin,'Private human reason','Synthetic UI verification: retain the confirmed full protected-passage reproduction outcome in this test round.');
 await fill(admin,'Independently confirmed human finding','Inspected the immutable selected full protected passage and the recorded CONFIRMED_VIOLATION under R-SYSTEM-COMMENTARY; synthetic QA entry only.');
 await fill(admin,'Public notice for this participant · optional','Human-confirmed test-round rule violation; this test entry is excluded from awards.');
 modal=find(await snapshot(admin),'dialog','Ban participant2?');await cli(admin,'check',[flatten(modal.children).find(n=>n.role==='checkbox').ref]);
 await step('Ban confirmed synthetic entry through UI',()=>click(admin,'button','Confirm ban'));await click(admin,'button','Refresh server data');await shot('admin-ten-participant-status.png');
 const after=await ok(admin,'/organizer/competitions/'+competition+'/participants/'+guilty.id);assert(after.moderationStatus==='BANNED'&&after.wallet.confirmedUsed===state.observations.participant2.wallet.confirmedUsed,'Moderation altered wallet');
 await click(admin,'button','Human review');const nodes=await snapshot(admin),row=flatten(nodes).find(n=>n.role==='row'&&flatten([n]).some(n=>n.text==='participant2'));
 assert(row,'Review row missing');await cli(admin,'click',[find(row.children,'button','Inspect integrity').ref]);await target(admin,'dialog','Review · participant2');await shot('admin-integrity-evidence.png');await click(admin,'button','Close dialog');
 state.status='ADMIN_INDIVIDUAL_UI_PASSED';save();log('All ten individual drawers and moderation UI passed');
}catch(e){state.status='FAILED_OR_PENDING';state.failure=e.message;save();log('ADMIN INSPECTION FAILED: '+e.message);process.exitCode=1;}