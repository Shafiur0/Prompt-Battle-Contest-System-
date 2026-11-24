import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);require('dotenv').config({quiet:true});
if(!process.argv.includes('--local-ui'))throw Error('Use --local-ui for synthetic organizer controls only; no model calls.');
const root=process.cwd(),run=promisify(execFile),origin=process.env.APP_ORIGIN||'http://localhost:3100',temp=path.join(root,'.local/browser-temp');
const env={...process.env,LOCALAPPDATA:path.join(temp,'appdata'),TEMP:path.join(temp,'tmp'),TMP:path.join(temp,'tmp')},npx=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npx-cli.js');
const ownerSession='one-page-organizer-control';let session=ownerSession;const sessions=[session];
const original=JSON.parse(fs.readFileSync('.local/system-tests/2026-11-21T19-01-24-139Z/run.json','utf8')),fixtureId=original.competitionId,draftId='331c8eb2-6714-4d7a-a56c-02eddd0e5330';
const dir=path.join(root,'.local/one-page-organizer',new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(dir,{recursive:true});
const record={status:'RUNNING',checks:[],fixtureId,draftId,announcementId:null,banApplied:false,banRestored:false,draftRestored:false,withdrawn:false,screenshots:[]},save=()=>fs.writeFileSync(path.join(dir,'run.json'),JSON.stringify(record,null,2)),assert=(ok,msg)=>{if(!ok)throw Error(msg);};
async function cli(command,args=[],json=false){const out=await run(process.execPath,[npx,'--yes','--package','@playwright/cli','playwright-cli','-s='+session,command,...args,...(json?['--json']:[])],{cwd:root,env,timeout:30000,maxBuffer:12*1024*1024});if(!json)return out.stdout;return JSON.parse(out.stdout.slice(out.stdout.indexOf('{')));}
function flat(nodes,out=[]){for(const n of nodes||[]){if(n&&typeof n==='object'){out.push(n);flat(n.children,out);}}return out;}
function text(nodes){return flat(nodes).map(n=>[n.name||'',n.text||'',...(n.children||[]).filter(x=>typeof x==='string')].join(' ')).join(' ');}
async function snap(){return flat((await cli('snapshot',[],true)).snapshot);}
const matches=(n,role,name)=>n.role===role&&(typeof name==='string'?n.name===name:name.test(n.name||''));
async function target(role,name){for(let i=0;i<14;i++){const found=(await snap()).filter(n=>matches(n,role,name));if(found.length===1)return found[0];await new Promise(r=>setTimeout(r,300));}throw Error('Missing '+role+' '+name);}
async function click(role,name){const n=await target(role,name);assert(!n.disabled,'Disabled '+name);await cli('click',[n.ref]);}
async function inside(scopeRole,scopeName,role,name){for(let i=0;i<14;i++){const scope=(await snap()).find(n=>matches(n,scopeRole,scopeName));if(scope){const found=flat(scope.children).filter(n=>matches(n,role,name));if(found.length===1)return found[0];}await new Promise(r=>setTimeout(r,300));}throw Error('Missing scoped '+name);}
async function scopedClick(scopeRole,scopeName,role,name){const n=await inside(scopeRole,scopeName,role,name);assert(!n.disabled,'Scoped disabled '+name);await cli('click',[n.ref]);}
async function fill(name,value){let n;for(let i=0;i<12;i++){const found=(await snap()).filter(n=>['textbox','searchbox','combobox'].includes(n.role)&&(typeof name==='string'?n.name===name:name.test(n.name||'')));if(found.length===1){n=found[0];break;}await new Promise(r=>setTimeout(r,300));}assert(n,'Input missing '+name);if(value.includes('\n'))await cli('run-code',['async(page)=>{await page.getByRole('+JSON.stringify(n.role)+',{name:'+JSON.stringify(n.name)+',exact:true}).fill('+JSON.stringify(value)+');}'],true);else await cli('fill',[n.ref,value]);}
async function api(route,method='GET',body){
 if(method!=='GET'){const allowed=route==='/organizer/competitions/'+draftId+'/problem'||route==='/organizer/competitions/'+fixtureId+'/participants/'+record.participantId+'/unban'||route==='/organizer/competitions/'+fixtureId+'/announcements/'+record.announcementId;assert(allowed,'Refusing writes outside the scoped synthetic fixtures');}
 const options={method,headers:{Origin:origin,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{data:body})};
 const r=await cli('run-code',['async(page)=>{const r=await page.request.fetch('+JSON.stringify(origin+'/api/v1'+route)+','+JSON.stringify(options)+');let data;try{data=await r.json();}catch{data={};}return {status:r.status(),data};}'],true);const v=typeof r.result==='string'?JSON.parse(r.result):r.result;assert(v.status>=200&&v.status<300,'Request rejected '+route+' '+v.status);return v.data;
}
async function choose(id){const c=await api('/competitions/'+id);assert(c.title.startsWith('SYSTEM TEST'),'Refusing a non-test competition');await click('button','Current competition');const check=await target('checkbox','Show samples and tests');await cli('check',[check.ref]);await fill('Search competitions',c.title);const entry=(await snap()).find(n=>n.role==='option'&&n.name.startsWith(c.title));assert(entry,'Fixture option missing');await cli('click',[entry.ref]);await new Promise(r=>setTimeout(r,500));return c;}
async function organizer(){const button=(await snap()).find(n=>matches(n,'button','Organizer'));if(button)await cli('click',[button.ref]);await target('button','View statement');}
async function step(name,fn){console.log(name);await fn();record.checks.push(name);save();}
async function closeModal(){await click('button','Close dialog');}
async function checkboxInDialog(){const d=(await snap()).find(n=>n.role==='dialog');assert(d,'Dialog missing');const n=flat(d.children).find(n=>n.role==='checkbox');assert(n,'Confirmation checkbox missing');await cli('check',[n.ref]);}
async function login(alias){const state=await api('/session');if(state.authenticated&&state.user?.alias===alias)return;await click('link','Sign in');await fill('Username or email',alias);await fill('Password',alias==='organizer'?'local-organizer-change-me':'local-participant-change-me');await click('button','Sign In');for(let i=0;i<20;i++){const s=await api('/session');if(s.authenticated&&s.user?.alias===alias)return;await new Promise(r=>setTimeout(r,300));}throw Error('Fixture login failed '+alias);}
async function bodyText(){const r=await cli('run-code',['async(page)=>({text:await page.locator("body").innerText()})'],true);return (typeof r.result==='string'?JSON.parse(r.result):r.result).text;}
async function saveAndReturn(){await click('button','Save problem');for(let i=0;i<20;i++){const nodes=await snap();if(nodes.some(n=>matches(n,'button','Edit problem'))&&!nodes.some(n=>n.role==='textbox'&&/^Problem statement/.test(n.name||'')))return;await new Promise(r=>setTimeout(r,300));}throw Error('Save did not return to the problem card');}
async function optionalExplanation(value){const n=(await snap()).find(n=>n.role==='textbox'&&/^(Explanation|Why is this correct|Notes)/.test(n.name||''));if(n)await fill(new RegExp('^'+(n.name.startsWith('Explanation')?'Explanation':n.name.startsWith('Notes')?'Notes':'Why is this correct')),value);}
async function screenshot(file){await snap();await cli('screenshot',['--filename='+file]);record.screenshots.push(path.join(root,file));save();}
const boardKey=board=>JSON.stringify(board.rows.map(r=>({id:r.participantId,alias:r.alias,rank:r.rank,solveOrder:r.solveOrder,score:r.score,status:r.status,eligible:r.eligible,tokens:r.tokens,penalty:r.copyingPenalty,time:r.solveElapsedMs})).sort((a,b)=>a.alias.localeCompare(b.alias)));
let originalDraft=null,originalDetail=null,initialBoard=null;
try{
 await cli('open',[origin,'--browser=chrome','--profile='+path.join(temp,'profiles/auto-admin-61121T190124139Z')]);await login('organizer');await choose(fixtureId);await organizer();
 await cli('resize',['1440','1000']);await cli('screenshot',['--filename=output/playwright/one-page-organizer-desktop.png']);
 await cli('resize',['390','844']);await cli('screenshot',['--filename=output/playwright/one-page-organizer-mobile.png']);
 console.log('Captured the final organizer page on desktop and mobile.');
}catch(e){console.error(e.message);process.exitCode=1;}finally{await cli('close').catch(()=>{});}
