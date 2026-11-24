import {pool} from './db';
import {compareLeaderboardRows,currentScoreAvailable} from './invariants';
interface RankingSettings {mode:string;rankingMode:string;resultsVisible:boolean;}
function numberOrNull(value:unknown):number|null {const n=Number(value);return value==null||!Number.isFinite(n)?null:n;}
function completionKey(row:any):bigint|null {
 if(!row.score?.eligible||row.score.correctness!==1||row.score.critical!==1||numberOrNull(row.solve_elapsed_ms)==null||Number(row.solve_elapsed_ms)<0||row.first_correct_at==null)return null;
 const date=new Date(row.first_correct_at);if(!Number.isFinite(date.getTime()))return null;
 const epoch=String(row.first_correct_epoch??'');
 if(/^\d+(\.\d{1,6})?$/.test(epoch)){const [seconds,fraction='']=epoch.split('.');return BigInt(seconds)*1000000n+BigInt(fraction.padEnd(6,'0'));}
 return BigInt(date.getTime())*1000n;
}
export function projectCompetitionRanking(source:any[],settings:RankingSettings){
 const rows=source.map(row=>({...row,score:settings.resultsVisible&&row.moderation_status!=='BANNED'&&currentScoreAvailable(row.status,row.score_decision_id,row.effective_decision_id)?row.score:null,ranking_mode:settings.rankingMode}));
 if(settings.resultsVisible)rows.sort(compareLeaderboardRows);
 const completions=rows.map(row=>({row,key:completionKey(row)})).filter((entry):entry is {row:any;key:bigint}=>entry.key!==null).sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
 const solveOrders=new Map<any,number>();let solveOrder=0,previousTime:bigint|null=null;
 for(let i=0;i<completions.length;i++){const entry=completions[i];if(entry.key!==previousTime)solveOrder=i+1;solveOrders.set(entry.row,solveOrder);previousTime=entry.key;}
 const firstSolverAliases=completions.filter(entry=>entry.key===completions[0]?.key).map(entry=>entry.row.alias);
 let rank=0,previousRanked:any=null;
 return {mode:settings.mode,rankingMode:settings.rankingMode,resultsVisible:settings.resultsVisible,totalParticipants:rows.length,rankedParticipants:rows.filter(row=>!!row.score).length,solvedParticipants:completions.length,firstSolverAlias:firstSolverAliases[0]??null,firstSolverAliases,
 rows:rows.map((row,index)=>{if(row.score){if(!previousRanked||compareLeaderboardRows(previousRanked,row)!==0)rank=index+1;previousRanked=row;}const hasCompletion=solveOrders.has(row),scored=!!row.score;return {participantId:row.participant_id,rank:scored?rank:null,solveOrder:hasCompletion?solveOrders.get(row)!:null,eligible:scored?!!row.score.eligible:null,alias:row.alias,status:row.moderation_status==='BANNED'?'BANNED':scored?'FINALIZED':!settings.resultsVisible?row.workspace_state:row.workspace_state==='NO_SUBMISSION'?'NO_SUBMISSION':'PENDING',score:row.score?.finalScore??null,quality:row.score?.quality??null,correctness:row.score?.correctness??null,efficiency:row.score?.efficiency??null,tokens:numberOrNull(row.consumed),copyingPenalty:scored?numberOrNull(row.penalty):null,penaltySource:scored?(row.decision_mode==='AUTOMATIC_REVIEWER'?'AI_REVIEWER':'HUMAN'):null,solveElapsedMs:hasCompletion?numberOrNull(row.solve_elapsed_ms):null,firstCorrectAt:hasCompletion?new Date(row.first_correct_at).toISOString():null,problemRevision:row.score?.problemRevision??null,problemVersionId:row.score?.problemVersionId??null};})};
}
export async function competitionRanking(c:any,organizerView=false){
 const rows=(await pool.query('SELECT p.id AS participant_id,u.alias,p.workspace_state,t.consumed,p.moderation_status,s.status,s.effective_decision_id,sc.decision_id AS score_decision_id,sc.score,st.elapsed_ms AS solve_elapsed_ms,st.first_correct_at,extract(epoch FROM st.first_correct_at)::text AS first_correct_epoch,d.penalty,d.mode AS decision_mode FROM participants p JOIN users u ON u.id=p.user_id LEFT JOIN token_accounts t ON t.participant_id=p.id LEFT JOIN final_selections f ON f.participant_id=p.id LEFT JOIN submission_states s ON s.selection_id=f.id LEFT JOIN score_revisions sc ON sc.id=s.published_score_id LEFT JOIN solving_timings st ON st.selection_id=f.id LEFT JOIN policy_reviews d ON d.id=s.effective_decision_id WHERE p.competition_id=$1 ORDER BY p.created_at,p.id',[c.id])).rows;
 const resultsVisible=organizerView?!!c.closure_epoch:['REVEALED','CALIBRATION_REVEALED'].includes(c.status);
 return projectCompetitionRanking(rows,{mode:resultsVisible?(c.calibration?'LOCAL_CALIBRATION':'OFFICIAL'):'PUBLIC_PRACTICE',rankingMode:c.manifest.rankingMode||'QUALITY_TOKENS',resultsVisible});
}
export function rankingPosition(board:ReturnType<typeof projectCompetitionRanking>,participantId:string){const row=board.rows.find(entry=>entry.participantId===participantId);return row?{rank:row.rank,solveOrder:row.solveOrder,eligible:row.eligible,totalParticipants:board.totalParticipants,solveElapsedMs:row.solveElapsedMs,firstCorrectAt:row.firstCorrectAt}:null;}
