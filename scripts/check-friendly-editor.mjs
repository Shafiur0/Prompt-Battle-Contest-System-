import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);require('dotenv').config({quiet:true});
if(!process.argv.includes('--local-ui'))throw Error('Pass --local-ui for this isolated, provider-free editor check.');
const root=process.cwd(),run=promisify(execFile),origin=process.env.APP_ORIGIN||'http://localhost:3100',session='friendly-editor';
const npx=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npx-cli.js'),temp=path.join(root,'.local/browser-temp');
const env={...process.env,LOCALAPPDATA:path.join(temp,'appdata'),TEMP:path.join(temp,'tmp'),TMP:path.join(temp,'tmp')};
const folder=path.join(root,'.local/friendly-editor'),resuming=process.argv.includes('--resume');
const previousDir=resuming?path.join(folder,fs.readdirSync(folder).sort().at(-1)):null;
const previous=previousDir?JSON.parse(fs.readFileSync(path.join(previousDir,'run.json'),'utf8')):null;
if(previous&&!previous.title.startsWith('SYSTEM TEST · Friendly editor · '))throw Error('Refusing non-test resume');
const title=previous?.title||'SYSTEM TEST · Friendly editor · '+new Date().toISOString(),dir=previousDir||path.join(folder,new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(dir,{recursive:true});const result=previous||{title,status:'RUNNING',checks:[],competitionId:null};
if(result.failure){result.previousFailures??=[];result.previousFailures.push(result.failure);delete result.failure;}result.status='RUNNING';
const save=()=>fs.writeFileSync(path.join(dir,'run.json'),JSON.stringify(result,null,2));
const assert=(ok,message)=>{if(!ok)throw Error(message);};
async function cli(command,args=[],json=false){const out=await run(process.execPath,[npx,'--yes','--package','@playwright/cli','playwright-cli','-s='+session,command,...args,...(json?['--json']:[])],{cwd:root,env,timeout:30000,maxBuffer:8*1024*1024});if(!json)return out.stdout;const at=out.stdout.indexOf('{');assert(at>=0,'CLI JSON response missing');return JSON.parse(out.stdout.slice(at));}
function flat(nodes,out=[]){for(const node of nodes||[]){if(node&&typeof node==='object'){out.push(node);flat(node.children,out);}}return out;}
async function snapshot(){return flat((await cli('snapshot',[],true)).snapshot);}
async function target(role,name){for(let i=0;i<12;i++){const matches=(await snapshot()).filter(n=>n.role===role&&(typeof name==='string'?n.name===name:name.test(n.name||'')));if(matches.length===1)return matches[0];await new Promise(r=>setTimeout(r,350));}throw Error('Missing or ambiguous '+role+' '+name);}
async function click(role,name){const n=await target(role,name);assert(!n.disabled,'Disabled '+name);await cli('click',[n.ref]);}
async function fill(name,value){const n=await target('textbox',name);if(value.includes('\n')){await cli('run-code',['async(page)=>{await page.getByRole("textbox",{name:'+JSON.stringify(n.name)+',exact:true}).fill('+JSON.stringify(value)+');}',],true);}else await cli('fill',[n.ref,value]);}
async function api(route){const r=await cli('run-code',['async(page)=>{const r=await page.request.get('+JSON.stringify(origin+'/api/v1'+route)+');return {status:r.status(),data:await r.json()};}'],true);const data=typeof r.result==='string'?JSON.parse(r.result):r.result;assert(data.status===200,'API read rejected '+route);return data.data;}
async function step(name,fn){console.log(name);await fn();result.checks.push(name);save();}
try{
 await cli('goto',[origin]);await target('button','Competitions');
 await step('Create a separate draft through the visible UI',async()=>{if(result.competitionId){await click('button','Organizer');await click('button','Problem');await target('heading','Write the problem');return;}await click('button','Competitions');await click('button','New competition');await fill('Competition title',title);await click('button','Create draft');await target('heading','Write the problem');const list=(await api('/competitions')).competitions;result.competitionId=list.find(c=>c.title===title)?.id;assert(result.competitionId,'Created draft identity missing');});
 const statement='Compute six multiplied by seven.\n\nInclude a short explanation of your calculation.';
 const explanation='QA private reference: six multiplied by seven equals forty-two.';
 await step('Write a plain problem without technical configuration',async()=>{const nodes=await snapshot();assert(!nodes.some(n=>n.role==='textbox'&&/schema|Requirement ID|Check ID/.test(n.name||'')),'Technical editor visible in the writing step');await fill(/^Problem title/,'Multiplication challenge');await fill(/^Problem statement/,statement);await click('button','Continue to answer setup');await target('button',/^A number/);});
 await step('Invalid answers are rejected before saving',async()=>{await fill(/^Correct answer/,'6*7');await fill(/^Why is this correct/,explanation);await click('button','Review problem');const nodes=await snapshot(),text=nodes.map(n=>n.text||n.name||'').join(' ');assert(/numeric answer/.test(text),'Numeric validation not shown');await target('heading','Set up the answer');});
 await step('Preview and save a numeric reference with no JSON editing',async()=>{await fill(/^Correct answer/,'42');await click('button','Review problem');await target('heading','Review & save');await click('button','Save problem');await target('button','Saved');const view=await api('/organizer/competitions/'+result.competitionId+'/problem');assert(view.draft.statement===statement,'Statement line breaks were changed');assert(view.draft.referenceAnswer.result===42&&view.draft.referenceAnswer.rationale===explanation,'Private reference differs');assert(view.draft.checks.length===2&&view.draft.checks.every(c=>c.essential&&c.visibility==='private'),'Prepared scoring checks incorrect');assert(!view.publicProblem.statement.includes('QA private reference'),'Private explanation leaked into the public problem');});
 await step('Reload restores the selected round and simple setup',async()=>{await cli('reload');await click('button','Organizer');await click('button','Problem');await target('heading','Write the problem');await click('button','Continue to answer setup');await target('button',/^A number/);assert(!(await snapshot()).some(n=>n.name==='Custom answer rules'),'Saved simple draft did not round-trip');await click('button','Back');});
 await step('Searchable menu hides old tests and handles keyboard selection',async()=>{await click('button','Current competition');const nodes=await snapshot();assert(nodes.some(n=>n.role==='combobox'&&n.name==='Search competitions'),'Search missing');assert(!nodes.some(n=>n.role==='option'&&/Automatic ten participant exercise/.test(n.name||'')),'Old test clutter visible by default');const search=nodes.find(n=>n.role==='combobox'&&n.name==='Search competitions');await cli('fill',[search.ref,'Friendly editor']);await target('option',new RegExp('Friendly editor'));await cli('press',['Enter']);assert(!(await snapshot()).some(n=>n.role==='dialog'&&n.name==='Choose a competition'),'Keyboard selection did not close menu');});
 await step('Responsive writing layout renders on a small screen',async()=>{await cli('resize',['390','844']);await target('textbox',/^Problem statement/);await cli('screenshot',['--filename=output/playwright/friendly-problem-mobile.png']);await cli('resize',['1280','900']);await cli('screenshot',['--filename=output/playwright/friendly-problem-editor.png']);});
 result.status='PASSED';save();console.log(JSON.stringify({status:result.status,checks:result.checks.length,competitionId:result.competitionId,evidence:dir}));
}catch(error){result.status='FAILED';result.failure=error.message;save();console.error(error.message);process.exitCode=1;}
