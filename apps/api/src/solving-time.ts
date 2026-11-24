import {evaluateAnswer,type CompetitionProblem} from '@prompt-battle/core';
export function earliestCorrectCompletion(attempts:Array<{id:string;problemVersionId:string;answer:string;receivedAt:string|Date}>,selectedVersionId:string,startedAt:string|Date,problem:CompetitionProblem,selectedEligible:boolean){
 const start=new Date(startedAt).getTime();if(!Number.isFinite(start))throw new Error('Invalid server competition start');
 if(!selectedEligible)return {firstCorrectAttemptId:null,firstCorrectAt:null,elapsedMs:null};
 const eligible=attempts.filter(a=>a.problemVersionId===selectedVersionId&&Number.isFinite(new Date(a.receivedAt).getTime())&&new Date(a.receivedAt).getTime()>=start&&(()=>{const result=evaluateAnswer(a.answer,problem);return result.eligible&&result.C===1&&result.K===1;})()).sort((a,b)=>new Date(a.receivedAt).getTime()-new Date(b.receivedAt).getTime());
 const first=eligible[0];return first?{firstCorrectAttemptId:first.id,firstCorrectAt:new Date(first.receivedAt).toISOString(),elapsedMs:Math.floor(new Date(first.receivedAt).getTime()-start)}:{firstCorrectAttemptId:null,firstCorrectAt:null,elapsedMs:null};
}