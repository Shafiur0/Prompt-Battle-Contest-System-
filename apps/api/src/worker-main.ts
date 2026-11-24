import 'reflect-metadata';
import { Queue,Worker } from 'bullmq';
import { config } from './config';
import { pool } from './db';
import { generate,recoverGenerationUsage } from './workers/generation';
import { evaluateQuality,evaluateIntegrity } from './workers/evaluation';
import {evaluateAutomaticIntegrity} from './workers/automatic-integrity';
import { finalize } from './workers/finalization';
import { OrganizerService } from './organizer';
const url=new URL(config.redisUrl);
const connection={host:url.hostname,port:Number(url.port||6379),password:url.password||undefined,username:url.username||undefined,maxRetriesPerRequest:null};
const queue=new Queue('prompt-battle',{connection});
let producing=false,recovering=false;
async function produce(){
 if(producing)return;producing=true;
 try{
  await pool.query('UPDATE outbox_jobs SET status=\'QUEUED\' WHERE status IN (\'DISPATCHED\',\'RUNNING\') AND claimed_at<clock_timestamp()-interval \'3 minutes\'');
  const jobs=(await pool.query('SELECT * FROM outbox_jobs WHERE status=\'QUEUED\' AND available_at<=clock_timestamp() ORDER BY available_at LIMIT 20')).rows;
  for(const row of jobs){
   await queue.add(row.kind,{outboxId:row.id},{jobId:row.id,attempts:1,removeOnComplete:{age:86400},removeOnFail:false});
   await pool.query('UPDATE outbox_jobs SET status=\'DISPATCHED\',claimed_at=clock_timestamp() WHERE id=$1 AND status=\'QUEUED\'',[row.id]);
  }
 }catch{ /* Outbox stays durable when Redis is unavailable. */ }finally{producing=false;}
}
const worker=new Worker('prompt-battle',async job=>{
 const row=(await pool.query('UPDATE outbox_jobs SET status=\'RUNNING\',claimed_at=clock_timestamp(),attempts=attempts+1 WHERE id=$1 AND status<>\'DONE\' RETURNING *',[job.data.outboxId])).rows[0];
 if(!row)return;
 try{
  if(row.kind==='GENERATE')await generate(row.payload.callId);
  else if(row.kind==='QUALITY')await evaluateQuality(row.payload.selectionId);
  else if(row.kind==='INTEGRITY')await evaluateIntegrity(row.payload.selectionId,row.payload.closureEpoch);
  else if(row.kind==='AUTOMATIC_APPEAL')await evaluateAutomaticIntegrity(row.payload.selectionId,row.payload.closureEpoch,row.payload.appealId);
  else if(row.kind==='FINALIZE')await finalize(row.payload.selectionId);
  else throw new Error('UNKNOWN_OUTBOX_OPERATION');
  await pool.query('UPDATE outbox_jobs SET status=\'DONE\',failure_reason=NULL WHERE id=$1',[row.id]);
 }catch(error){
  const message=error instanceof Error?error.message:'WORKER_OPERATION_FAILED';
  await pool.query('UPDATE outbox_jobs SET status=\'FAILED\',failure_reason=$2 WHERE id=$1',[row.id,message.slice(0,200)]);
  console.error('A backend worker operation is pending operator review.');
 }
},{connection,concurrency:2,lockDuration:180000});
worker.on('error',()=>console.error('Worker queue connection needs attention.'));
queue.on('error',()=>{});
async function maintenance(){
 if(recovering)return;recovering=true;
 try{
  await recoverGenerationUsage();
  const due=(await pool.query('SELECT id FROM competitions WHERE status=\'GENERATION_OPEN\' AND selection_cutoff<=clock_timestamp()')).rows;
  for(const c of due)await new OrganizerService().close(c.id,null);
 }catch{ /* Do not fabricate a settlement or closure on dependency failure. */ }finally{recovering=false;}
}
setInterval(()=>void produce(),500);
setInterval(()=>void maintenance(),10000);
void produce();
console.log('Prompt Battle worker started; PostgreSQL outbox is authoritative.');
async function shutdown(){await worker.close();await queue.close();await pool.end();process.exit(0);}
process.on('SIGTERM',()=>void shutdown());process.on('SIGINT',()=>void shutdown());
