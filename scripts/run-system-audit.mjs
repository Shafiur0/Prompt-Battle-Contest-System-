import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),root=process.cwd();
require('dotenv').config({quiet:true});
const index=process.argv.indexOf('--run'),dir=path.resolve(process.argv[index+1]||'');
if(index<0||!dir.startsWith(path.join(root,'.local/system-tests')+path.sep))throw new Error('Isolated test run directory required');
const file=path.join(dir,'run.json'),state=JSON.parse(fs.readFileSync(file,'utf8'));
if(!state.title.startsWith('SYSTEM TEST'))throw new Error('Refusing a non-test round');
const env={SYSTEM_TEST_DATABASE_URL:process.env.DATABASE_URL,PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP};
const args=['scripts/system-test-audit.mjs','--competition',state.competitionId,'--expected-title',state.title,'--observations',file,'--pretty'];
if(process.argv.includes('--allow-pending'))args.push('--allow-pending');
const child=spawnSync(process.execPath,args,{cwd:root,env,encoding:'utf8',maxBuffer:8*1024*1024,timeout:60000});
if(!child.stdout){console.error('Scoped audit could not complete. No provider calls made.');process.exitCode=1;}else{
 const report=JSON.parse(child.stdout);fs.writeFileSync(path.join(dir,'audit.json'),child.stdout);
 console.log(JSON.stringify({ok:report.ok,summary:report.summary,failures:report.failures,pending:report.pending,warnings:report.warnings,participants:report.participants},null,2));process.exitCode=child.status||0;
}