import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {buildSystemTestProblemDraft,SYSTEM_TEST_TITLE_PREFIX,SYSTEM_TEST_RULE,SYSTEM_TEST_PROTECTED_COMMENTARY,SYSTEM_TEST_SCENARIOS} from './system-test-fixtures.mjs';
const run=promisify(execFile),root=process.cwd(),origin='http://localhost:3000';
const npx=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npx-cli.js');
if(!fs.existsSync(npx))throw new Error('npx runtime unavailable');
if(!process.argv.includes('--resolve-synthetic'))throw new Error('Explicit synthetic resolution required.');
const dir=path.join(root,'.local/system-tests/2026-11-20T21-54-21-554Z');
const state=JSON.parse(fs.readFileSync(path.join(dir,'run.json'),'utf8'));
if(state.competitionId!=='5a08b128-dc70-4a90-adbe-0dca032c49a1'||!state.title.startsWith('SYSTEM TEST'))throw new Error('Wrong synthetic round');function save(){fs.writeFileSync(path.join(dir,'run.json'),JSON.stringify(state,null,2));}
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
 await login(admin,'organizer');let board=await ok(admin,'/organizer/competitions/'+state.competitionId);
 await step('Resolve actual original test prompts without false copying penalties',async()=>{for(const c of board.cases){assert(c.copyEvidence?.length===0,'Original run unexpectedly contains protected evidence');if(c.decision?.verdict==='NO_VIOLATION')continue;await ok(admin,'/organizer/submissions/'+c.submissionId+'/reviews','POST',{verdict:'NO_VIOLATION',severity:'NONE',reason:'Synthetic QA administrator inspected the actual immutable prompt and retained comparison evidence. The test automation sent only the first line for multiline fixtures, so the intended protected passage was not present. No reproduction violation is established.'},crypto.randomUUID());}});
 for(let i=0;i<60;i++){board=await ok(admin,'/organizer/competitions/'+state.competitionId);if(board.cases.every(c=>c.status==='FINALIZED'))break;if(i===59)throw new Error('Original round finalization pending');await new Promise(r=>setTimeout(r,500));}
 await ok(admin,'/organizer/competitions/'+state.competitionId+'/reveal','POST',{});
 state.observations.leaderboard=await ok(admin,'/competitions/'+state.competitionId+'/leaderboard');state.observations.finalDashboard=board;
 for(const actor of state.actors){actor.final=await ok(actor.session,'/submissions/'+actor.submissionId);actor.wallet=await ok(actor.session,'/competitions/'+state.competitionId+'/token-account');actor.history=(await ok(actor.session,'/competitions/'+state.competitionId+'/attempts')).attempts;}
 state.status='ORIGINAL_RUN_RESOLVED_WITH_INPUT_COVERAGE_FAILURE';state.resolution='Historical inputs and charges retained. Actual prompts cleared after evidence inspection; copied-input coverage was not achieved in this run. Corrected fresh round tested separately.';save();log('Original input-error round resolved without fabricated violations or model reruns');
}catch(e){state.resolutionFailure=e.message;save();log('Original resolution pending: '+e.message);process.exitCode=1;}