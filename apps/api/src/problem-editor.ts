import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { validateStructuredProblemDraft,buildStructuredProblem,validateRegistry,type CriticalRegistry } from '@prompt-battle/core';
import type { AppUser } from './auth';
import { transaction,audit } from './db';
import { competitionRow,registryFor,digest } from './domain';
import { assertOrganizerScope } from './create-competition';
import { fail } from './guards';
import { GENERATION_ENVELOPE,REVIEW_PACKAGE,REVIEW_PACKAGE_DIGEST } from './config';
function editorView(problem:any){
 const kind=problem.kind||'ALLOCATION';
 return {problemKind:kind,versionId:problem.versionId,draft:kind==='STRUCTURED_JSON'?{kind,title:problem.title,statement:problem.structured.baseStatement,objectives:problem.structured.objectives,constraints:problem.structured.constraints,requirements:problem.structured.requirements,outputSchema:problem.structured.outputSchema,checks:problem.structured.checks,referenceAnswer:problem.structured.referenceAnswer}:null,
 publicProblem:{title:problem.title,statement:problem.statement,...(kind==='STRUCTURED_JSON'?{outputSchema:problem.structured.outputSchema}:{})}};
}
@Injectable()
export class ProblemEditorService {
 async get(id:string,u:AppUser){const c=await competitionRow(id);assertOrganizerScope(c,u);return c.problem_deleted?{deleted:true,problemKind:'NONE',versionId:null,draft:null,publicProblem:null}:{...editorView(c.problem),deleted:false};}
 async save(id:string,u:AppUser,raw:unknown){
  let draft:ReturnType<typeof validateStructuredProblemDraft>;
  try{draft=validateStructuredProblemDraft(raw);}catch(error){fail(400,error instanceof Error?error.message:'The structured problem draft is invalid.');}
  return transaction(async db=>{
   const c=await competitionRow(id,db,true);assertOrganizerScope(c,u);

   const oldRegistry=await registryFor(c,db);
   const versionId=randomUUID(),registryVersionId=randomUUID(),ruleId=randomUUID();
   let problem=buildStructuredProblem(draft,{problemId:c.problem.kind==='STRUCTURED_JSON'?c.problem.id:randomUUID(),versionId,registryId:oldRegistry.id,registryVersionId,policyVersionId:randomUUID()});
   const preserved=oldRegistry.items.filter(i=>i.category==='PROTECTED_CRITICAL_INFORMATION'||i.category==='ALLOWED_PUBLIC_INFORMATION').flatMap(i=>{
    if(!i.text)return [];
    const index=problem.statement.indexOf(i.text);
    if(index<0){if(c.status==='DRAFT'&&i.category==='PROTECTED_CRITICAL_INFORMATION')fail(409,'A protected source quote would disappear. Remove or update that draft registry designation before saving the new problem.');return [];}
    const start=Buffer.byteLength(problem.statement.slice(0,index),'utf8');
    return [{...i,sourceStartByte:start,sourceEndByte:start+Buffer.byteLength(i.text,'utf8')}];
   });
   const registry:CriticalRegistry={...problem.registry,items:[...problem.registry.items,...preserved]};
   try{validateRegistry(registry);}catch{fail(400,'Protected/allowed source designations conflict with the new public requirements. Adjust the draft registry first.');}
   problem={...problem,registry};
   const sequence=Number((await db.query('SELECT COALESCE(max(sequence),0)+1 AS n FROM problem_versions WHERE competition_id=$1',[id])).rows[0].n);
   await db.query('INSERT INTO problem_versions(id,competition_id,version_id,sequence,content,digest) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),id,versionId,sequence,JSON.stringify(problem),digest(problem)]);
   const registrySequence=Number((await db.query('SELECT COALESCE(max(sequence),0)+1 AS n FROM registry_versions WHERE competition_id=$1',[id])).rows[0].n);
   await db.query('INSERT INTO registry_versions(id,competition_id,sequence,registry,digest) VALUES($1,$2,$3,$4,$5)',[registryVersionId,id,registrySequence,JSON.stringify(registry),digest(registry)]);
   const ruleSequence=Number((await db.query('SELECT COALESCE(max(sequence),0)+1 AS n FROM competition_rules_versions WHERE competition_id=$1',[id])).rows[0].n);
   const manifest={...c.manifest,...(c.status==='DRAFT'?{version:3,reviewMode:'AUTOMATIC_REVIEWER',rankingMode:'EARLIEST_CORRECT_TIEBREAK_V1',reviewPackage:REVIEW_PACKAGE,reviewPackageDigest:REVIEW_PACKAGE_DIGEST,systemEnvelope:GENERATION_ENVELOPE,providerQualified:false,qualificationEvidence:null}:{}),problemKind:'STRUCTURED_JSON',problemRevision:sequence,problemVersionId:versionId,problemDigest:digest(problem),outputSchemaDigest:digest(draft.outputSchema),checksDigest:digest(draft.checks),registryVersionId};
   await db.query('INSERT INTO competition_rules_versions(id,competition_id,sequence,manifest,digest) VALUES($1,$2,$3,$4,$5)',[ruleId,id,ruleSequence,JSON.stringify(manifest),digest(manifest)]);
   if(c.status!=='DRAFT')await db.query("SELECT set_config('prompt_battle.allow_problem_revision','on',true)");
   await db.query('UPDATE competitions SET problem=$2,problem_deleted=false,registry_version_id=$3,rules_version_id=$4 WHERE id=$1',[id,JSON.stringify(problem),registryVersionId,ruleId]);
   await audit(db,id,u.id,c.status==='DRAFT'?'STRUCTURED_PROBLEM_DRAFT_VERSION_SAVED':'STRUCTURED_PROBLEM_REVISION_SAVED',{versionId,registryVersionId,outputSchemaDigest:manifest.outputSchemaDigest,checksDigest:manifest.checksDigest});
   return {...editorView(problem),deleted:false};
  });
 }
}
