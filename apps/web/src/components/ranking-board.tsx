"use client";
import { useId, useMemo, useState } from "react";
import type { LeaderboardView } from "@/lib/views";
import { firstCorrectSolvers, formatCompletionTime, formatRankingPosition, isRankedResult, rankingResultsVisible, rankingStatus, rankingViewRows, type RankingFilter, type RankingOrder, type RankingRow } from "@/lib/ranking-format";
import { Badge, Empty, Icon, Notice, number } from "./ui";
import styles from "./ranking-board.module.css";

export interface RankingBoardProps {
 data: LeaderboardView | null;
 loading?: boolean;
 error?: string | null;
 alias?: string | null;
 onInspect?: (alias: string) => void;
}
const percentage = (value?:number|null) => value == null || !Number.isFinite(value) ? "Pending" : (value * 100).toFixed(1) + "%";
const scoreText = (value?:number|null) => value == null || !Number.isFinite(value) ? "Pending" : value.toFixed(2);

export function PersonalStanding({data,alias,compact=false}:{data:LeaderboardView|null;alias?:string|null;compact?:boolean}) {
 const visible = rankingResultsVisible(data);
 const row = alias ? data?.rows.find(item => item.alias === alias) : undefined;
 const finalized = visible && row?.score != null;
 const withheld = row?.status.toUpperCase() === "BANNED";
 const count = data?.totalParticipants ?? data?.rows.length;
 const rank = finalized && !withheld ? formatRankingPosition(row?.rank) : "—";
 const order = finalized && !withheld ? formatRankingPosition(row?.solveOrder) : "—";
 return <section className={compact?styles.personalCompact:styles.personal} aria-label="Your competition standing">
  {!compact&&<div className={styles.personalHeading}><Icon name="people" size={17}/><strong>Your standing</strong><span>{alias}</span></div>}
  <div className={styles.personalStats}>
   <div><span>Problem rank</span><strong>{rank!=="—"?rank:withheld?"Withheld":"Pending"}</strong><small>{rank!=="—"&&count!=null?"of "+count+" participants":"Final score determines problem rank"}</small></div>
   <div><span>Solved first</span><strong>{order!=="—"?order:withheld?"Withheld":finalized?"Not recorded":"Pending"}</strong><small>Order of fully correct answers</small></div>
   <div><span>First correct completion</span><strong>{finalized&&!withheld&&row?.solveElapsedMs!=null?formatCompletionTime(row.solveElapsedMs):withheld?"Withheld":finalized?"Not recorded":"Pending"}</strong><small>Time from competition start</small></div>
  </div>
 </section>;
}

function RowDetails({row,visible,onInspect}:{row:RankingRow;visible:boolean;onInspect?:RankingBoardProps["onInspect"]}) {
 return <div className={styles.rowActions}>
  {onInspect&&<button className="button small" type="button" aria-label={"View details for "+row.alias} onClick={()=>onInspect(row.alias)}>View details</button>}
  <details className={styles.breakdown}><summary>{onInspect?"Score breakdown":"Details"}</summary><dl>
   <div><dt>Generation tokens</dt><dd>{row.tokens==null?"Pending":number(row.tokens)}</dd></div>
   {visible&&<><div><dt>Solution quality</dt><dd>{percentage(row.quality)}</dd></div><div><dt>Correctness</dt><dd>{percentage(row.correctness)}</dd></div><div><dt>Token efficiency</dt><dd>{percentage(row.efficiency)}</dd></div><div><dt>Copying deduction</dt><dd>{row.copyingPenalty==null?"Pending":row.copyingPenalty+" points"}</dd></div><div><dt>Task revision</dt><dd>{row.problemRevision??"Recorded"}</dd></div></>}
  </dl></details>
 </div>;
}

export default function RankingBoard({data,loading=false,error,alias,onInspect}:RankingBoardProps) {
 const [query,setQuery]=useState("");
 const [filter,setFilter]=useState<RankingFilter>("all");
 const [order,setOrder]=useState<RankingOrder>("overall");
 const id=useId(),visible=rankingResultsVisible(data);
 const rows=useMemo(()=>rankingViewRows(data?.rows||[],{query,filter,order,resultsVisible:visible}),[data,query,filter,order,visible]);
 if(!data)return <>{error&&<Notice error>{error}</Notice>}<section className="card"><Empty icon="trophy" title={error?"Standings unavailable":"Loading the standings"}>{error?"Please refresh once the competition service is available.":"We are retrieving the participant list and recorded results."}</Empty></section></>;
 const count=data.totalParticipants??data.rows.length;
 const ranked=visible?(data.rankedParticipants??data.rows.filter(isRankedResult).length):0;
 const solved=visible?(data.solvedParticipants??data.rows.filter(row=>formatRankingPosition(row.solveOrder)!=="—").length):0;
 const firstSolvers=firstCorrectSolvers(data);
 const leaders=visible?data.rows.filter(row=>row.rank===1&&row.eligible!==false&&isRankedResult(row)):[];
 const leader=leaders.map(row=>row.alias).join(", ");
 const myRow=alias?data.rows.find(row=>row.alias===alias):undefined;
 const calibration=data.mode.toUpperCase()==="LOCAL_CALIBRATION"||data.mode.toUpperCase()==="CALIBRATION";
 const pending=rankingViewRows(data.rows,{filter:"pending",resultsVisible:visible}).length;
 return <div className={styles.board}>
  {error&&<Notice error>{error}</Notice>}
  <div className={styles.summary}>
   <section className={styles.summaryCard}><span className={styles.summaryLabel}><Icon name="trophy" size={17}/>Problem leader</span><strong>{leader||(visible?"No eligible leader":"Results pending")}</strong><small>{leaders.length?scoreText(leaders[0].score)+" final points":visible?"A finalized eligible result is needed":"Rankings appear when results are available"}</small></section>
   <section className={styles.summaryCard+" "+styles.firstCard}><span className={styles.summaryLabel}><Icon name="history" size={17}/>First correct solver</span><strong>{firstSolvers.join(", ")||(visible?"No recorded correct completion":"Results pending")}</strong><small>{firstSolvers.length>1?"These participants share first solving position":firstSolvers.length?"First fully correct answer in this competition":"Correct completion is recorded by the server"}</small></section>
   <section className={styles.summaryCard}><span className={styles.summaryLabel}><Icon name="people" size={17}/>Participants</span><strong>{count}</strong><small>{visible?ranked+" ranked · "+solved+" solved":count+" enrolled · results pending"}</small></section>
  </div>
  {myRow&&<PersonalStanding data={data} alias={alias}/>}
  <section className={"card "+styles.standings} aria-label="Competition standings">
   <div className={styles.heading}><div><h2>Competition standings</h2><p>{data.rankingMode==="EARLIEST_CORRECT_TIEBREAK_V1"?"Final score leads. The earliest correct completion breaks equal scores.":"Problem rank follows the competition's final score and tie rules."}</p><small>Solved first shows who completed a fully correct answer in each position.</small></div><div className={styles.headingBadges}>{calibration&&<Badge tone="amber">Calibration</Badge>}{loading&&<span className="spinner" aria-label="Refreshing standings"/>}</div></div>
   {!visible&&<div className={styles.sealed}><Icon name="lock" size={16}/><span>Scores and solving positions are pending. Every enrolled participant is listed below.</span></div>}
   <div className={styles.tools}><div className={styles.search}><Icon name="people" size={15}/><input aria-label="Search participants" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search participants"/>{query&&<button type="button" aria-label="Clear participant search" onClick={()=>setQuery("")}><Icon name="close" size={14}/></button>}</div><div className={styles.filters} role="group" aria-label="Filter standings">{([['all','All',count],['solved','Solved',solved],['pending','Pending',pending]] as const).map(([value,label,total])=><button key={value} type="button" className={filter===value?styles.filterActive:""} aria-pressed={filter===value} disabled={value==="solved"&&!visible} onClick={()=>setFilter(value)}>{label}<span>{total}</span></button>)}</div><label className={styles.viewLabel} htmlFor={id}>View<select id={id} value={order} onChange={event=>setOrder(event.target.value as RankingOrder)}><option value="overall">Final score</option><option value="solved" disabled={!visible}>Solved first</option></select></label></div>
   <div className={styles.viewNote}>{order==="solved"&&visible?"Viewing solving order. Problem rank and final points stay unchanged.":"Problem rank and solving order are separate positions."}</div>
   {rows.length?<div className={styles.tableWrap}><table className={styles.table}><thead><tr><th scope="col">Problem rank</th><th scope="col">Participant</th><th scope="col">Solved first</th><th scope="col">Final score</th><th scope="col">Correct completion</th><th scope="col">Details</th></tr></thead><tbody>{rows.map((row,index)=>{
    const finalized=visible&&row.score!=null,withheld=row.status.toUpperCase()==="BANNED";
    const rank=finalized&&!withheld?formatRankingPosition(row.rank):"—",solveOrder=finalized&&!withheld?formatRankingPosition(row.solveOrder):"—";
    return <tr key={row.participantId||row.alias+":"+index} className={row.alias===alias?styles.myRow:""}>
     <td data-label="Problem rank"><span className={styles.position+" "+(rank==="#1"?styles.firstPosition:"")}>{rank}</span></td>
     <td data-label="Participant" className={styles.participant}><div><strong>{row.alias}</strong>{row.alias===alias&&<span className={styles.you}>You</span>}</div><span className={styles.rowStatus+" "+(finalized&&row.eligible!==false&&!withheld?styles.rankedStatus:"")}>{rankingStatus(row,visible)}</span></td>
     <td data-label="Solved first"><span className={styles.solvePosition}>{solveOrder}</span>{solveOrder==="#1"&&<small>First solver</small>}</td>
     <td data-label="Final score"><strong className={styles.score}>{withheld?"Withheld":visible?scoreText(row.score):"Pending"}</strong><small>{visible&&row.copyingPenalty!=null?row.copyingPenalty===0?"No copying deduction":"−"+row.copyingPenalty+" copying points":"Deduction pending"}</small></td>
     <td data-label="Correct completion"><strong className={styles.duration}>{withheld?"Withheld":finalized?row.solveElapsedMs==null?"Not recorded":formatCompletionTime(row.solveElapsedMs):"Pending"}</strong></td>
     <td data-label="Details"><RowDetails row={row} visible={visible} onInspect={onInspect}/></td>
    </tr>;
   })}</tbody></table></div>:<Empty icon="people" title={count?"No participants match":"No participants yet"}>{count?"Try another name or select All to see every participant.":"Participants will appear after joining this competition."}</Empty>}
  </section>
 </div>;
}