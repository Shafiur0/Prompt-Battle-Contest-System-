import { createHash } from 'node:crypto';
import { artifactDigest as digest } from '../artifact-hash';
export async function archiveCallEvidence(db:any,callId:string,kind:string,raw:unknown){
 const value=raw===undefined?null:raw;
 await db.query('INSERT INTO provider_call_events(provider_call_id,kind,raw_evidence,evidence_digest) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[callId,kind,JSON.stringify(value),digest(value)]);
}
export async function claimEvaluation(db:any,selectionId:string,purpose:string,runId:string){
 const result=await db.query('INSERT INTO evaluation_claims(selection_id,purpose,revision,run_id) VALUES($1,$2,1,$3) ON CONFLICT DO NOTHING RETURNING run_id',[selectionId,purpose,runId]);
 return !!result.rowCount;
}
