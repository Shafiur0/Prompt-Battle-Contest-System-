import {pool} from './db';
import {currentScoreAvailable} from './invariants';

export interface OverallCompetitionSource {
 id:string;
 title:string;
 status:string;
 problem_title?:string|null;
}
export interface OverallParticipantSource {
 competition_id:string;
 user_id:string;
 alias:string;
 workspace_state:string;
 moderation_status?:string|null;
 selection_id?:string|null;
 status?:string|null;
 score_decision_id?:string|null;
 effective_decision_id?:string|null;
 score?:{eligible?:unknown;finalScore?:unknown;finalScoreExact?:unknown;correctness?:unknown;critical?:unknown}|null;
}
export type OverallProblemStatus='SCORED'|'PENDING'|'NO_SUBMISSION'|'NOT_JOINED'|'BANNED'|'INELIGIBLE';
interface ExactDecimal {units:bigint;scale:number;}
interface OverallProblemResult {competitionId:string;score:number|null;status:OverallProblemStatus;}
interface RankingDatabase {query(text:string,values?:any[]):Promise<{rows:any[]}>;}

const sampleTitles=new Set(['local verification draft','problem editor verification','supply allocation · local calibration']);
export function isSampleRankingCompetition(title:string):boolean {
 const normalized=title.trim().replace(/\s+/g,' ').toLocaleLowerCase('en-US');
 return /^system test\b/.test(normalized)||sampleTitles.has(normalized);
}
const released=(status:string)=>status==='REVEALED'||status==='CALIBRATION_REVEALED';

// Scores are persisted as decimal strings. Arithmetic and ties never use rounded display numbers.
function exactDecimal(value:unknown):ExactDecimal|null {
 if(typeof value!=='string'&&typeof value!=='number')return null;
 const text=String(value).trim();
 if(text.length>1024||!Number.isFinite(Number(text)))return null;
 const match=/^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(text);
 if(!match)return null;
 const fraction=match[3]??match[4]??'',exponent=Number(match[5]??0);
 if(!Number.isSafeInteger(exponent)||Math.abs(exponent)>1000)return null;
 let scale=fraction.length-exponent;
 if(Math.abs(scale)>1000)return null;
 let units=BigInt((match[2]??'0')+fraction)*(match[1]==='-'?-1n:1n);
 if(scale<0){units*=10n**BigInt(-scale);scale=0;}
 while(scale>0&&units%10n===0n){units/=10n;scale--;}
 return {units,scale};
}
function addExact(a:ExactDecimal,b:ExactDecimal):ExactDecimal {
 const scale=Math.max(a.scale,b.scale);
 return {units:a.units*10n**BigInt(scale-a.scale)+b.units*10n**BigInt(scale-b.scale),scale};
}
function compareExact(a:ExactDecimal,b:ExactDecimal):number {
 const scale=Math.max(a.scale,b.scale),left=a.units*10n**BigInt(scale-a.scale),right=b.units*10n**BigInt(scale-b.scale);
 return left<right?-1:left>right?1:0;
}
function exactText(value:ExactDecimal):string {
 if(value.units===0n)return '0';
 const negative=value.units<0n,absolute=(negative?-value.units:value.units).toString();
 if(!value.scale)return (negative?'-':'')+absolute;
 const digits=absolute.padStart(value.scale+1,'0'),integer=digits.slice(0,-value.scale),fraction=digits.slice(-value.scale).replace(/0+$/,'');
 return (negative?'-':'')+integer+(fraction?'.'+fraction:'');
}
function problemResult(member:OverallParticipantSource|undefined,visible:boolean):{result:OverallProblemResult;points:ExactDecimal|null;solved:boolean} {
 if(!member)throw new Error('Problem membership is required here.');
 const result:OverallProblemResult={competitionId:member.competition_id,score:null,status:'PENDING'};
 if(member.moderation_status==='BANNED'){result.status='BANNED';return {result,points:null,solved:false};}
 if(!visible)return {result,points:null,solved:false};
 if(!member.selection_id){result.status='NO_SUBMISSION';return {result,points:null,solved:false};}
 if(!currentScoreAvailable(member.status??'',member.score_decision_id,member.effective_decision_id)||!member.score)return {result,points:null,solved:false};
 if(member.score.eligible!==true){result.status='INELIGIBLE';return {result,points:null,solved:false};}
 const points=exactDecimal(member.score.finalScoreExact??member.score.finalScore);
 if(!points){result.status='INELIGIBLE';return {result,points:null,solved:false};}
 result.status='SCORED';result.score=Number(exactText(points));
 return {result,points,solved:member.score.correctness===1&&member.score.critical===1};
}

export function projectOverallRanking(source:OverallCompetitionSource[],members:OverallParticipantSource[],includeSamples=false) {
 const competitions=source.filter(c=>c.status!=='DRAFT'&&(includeSamples||!isSampleRankingCompetition(c.title)));
 const competitionIds=new Set(competitions.map(c=>c.id));
 const users=new Map<string,{userId:string;alias:string;members:Map<string,OverallParticipantSource>}>();
 for(const member of members){
  if(!competitionIds.has(member.competition_id))continue;
  let user=users.get(member.user_id);
  if(!user){user={userId:member.user_id,alias:member.alias,members:new Map()};users.set(member.user_id,user);}
  user.members.set(member.competition_id,member);
 }
 const calculated=[...users.values()].map(user=>{
  let points:ExactDecimal={units:0n,scale:0},scoredProblems=0,solvedProblems=0;
  const problems=competitions.map(c=>{
   const member=user.members.get(c.id);
   if(!member)return {competitionId:c.id,score:null,status:'NOT_JOINED' as const};
   const scored=problemResult(member,released(c.status));
   if(scored.points){points=addExact(points,scored.points);scoredProblems++;if(scored.solved)solvedProblems++;}
   return scored.result;
  });
  const totalPointsExact=exactText(points);
  return {row:{userId:user.userId,alias:user.alias,rank:null as number|null,totalPoints:Number(totalPointsExact),totalPointsExact,joinedProblems:user.members.size,scoredProblems,solvedProblems,problems},points};
 });
 calculated.sort((a,b)=>{
  const aRanked=a.row.scoredProblems>0,bRanked=b.row.scoredProblems>0;
  if(aRanked!==bRanked)return aRanked?-1:1;
  return (aRanked?-compareExact(a.points,b.points):0)||a.row.alias.localeCompare(b.row.alias,'en-US',{numeric:true,sensitivity:'base'})||a.row.userId.localeCompare(b.row.userId);
 });
 let rank=0,rankedParticipants=0,previous:ExactDecimal|null=null;
 for(const entry of calculated){
  if(!entry.row.scoredProblems)continue;
  rankedParticipants++;
  if(!previous||compareExact(entry.points,previous)!==0)rank=rankedParticipants;
  entry.row.rank=rank;previous=entry.points;
 }
 return {
  scope:'ALL_PROBLEMS' as const,scoring:'TOTAL_POINTS' as const,includeSamples,
  totalProblems:competitions.length,publishedProblems:competitions.filter(c=>released(c.status)).length,
  totalParticipants:calculated.length,rankedParticipants,
  problems:competitions.map(c=>({id:c.id,title:c.problem_title||c.title,competitionTitle:c.title,status:c.status,resultsVisible:released(c.status)})),
  rows:calculated.map(entry=>entry.row)
 };
}

export async function overallRanking(includeSamples=false,database:RankingDatabase=pool) {
 const source=(await database.query("SELECT id,title,status,problem->>'title' AS problem_title FROM competitions WHERE status<>'DRAFT' ORDER BY created_at,id")).rows as OverallCompetitionSource[];
 const competitions=source.filter(c=>includeSamples||!isSampleRankingCompetition(c.title));
 if(!competitions.length)return projectOverallRanking([],[],includeSamples);
 // Seal score values in SQL as well as projection, including scores superseded by an appeal.
 const members=(await database.query(`SELECT p.competition_id,p.user_id,u.alias,p.workspace_state,p.moderation_status,
 f.id AS selection_id,s.status,s.effective_decision_id,sc.decision_id AS score_decision_id,
 CASE WHEN c.status IN ('REVEALED','CALIBRATION_REVEALED') AND p.moderation_status<>'BANNED'
 AND s.status='FINALIZED' AND sc.decision_id=s.effective_decision_id
 THEN jsonb_build_object('eligible',sc.score->'eligible','finalScore',sc.score->'finalScore',
 'finalScoreExact',sc.score->'finalScoreExact','correctness',sc.score->'correctness','critical',sc.score->'critical')
 ELSE NULL END AS score
 FROM participants p JOIN users u ON u.id=p.user_id JOIN competitions c ON c.id=p.competition_id
 LEFT JOIN final_selections f ON f.participant_id=p.id AND f.competition_id=p.competition_id
 LEFT JOIN submission_states s ON s.selection_id=f.id
 LEFT JOIN score_revisions sc ON sc.id=s.published_score_id
 WHERE p.competition_id=ANY($1::uuid[]) ORDER BY p.created_at,p.id`,[competitions.map(c=>c.id)])).rows as OverallParticipantSource[];
 return projectOverallRanking(competitions,members,includeSamples);
}
