"use client";
import { Fragment, useId, useMemo, useState } from "react";
import type { OverallLeaderboardView } from "@/lib/views";
import { formatRankingPosition } from "@/lib/ranking-format";
import { Badge, Empty, Icon, Notice, number } from "./ui";
import styles from "./overall-leaderboard.module.css";

export interface OverallLeaderboardProps {
 data: OverallLeaderboardView | null;
 loading?: boolean;
 error?: string | null;
 alias?: string | null;
}
type OverallRow = OverallLeaderboardView["rows"][number];
type Result = OverallRow["problems"][number];
type Filter = "all" | "ranked" | "awaiting";
const points = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const pointText = (value: number) => Number.isFinite(value) ? points.format(value) : "—";
const isRanked = (row: OverallRow) => formatRankingPosition(row.rank) !== "—";
const awaitingCount = (row: OverallRow) => row.problems.filter(result => result.status === "PENDING").length;
const resultLabels: Record<Result["status"], string> = {
 SCORED: "Scored",
 PENDING: "Awaiting results",
 NO_SUBMISSION: "No final answer",
 NOT_JOINED: "Not joined",
 BANNED: "Withheld",
 INELIGIBLE: "Not eligible",
};

function ProblemResults({ row, problems }: { row: OverallRow; problems: OverallLeaderboardView["problems"] }) {
 const byId = new Map(problems.map(problem => [problem.id, problem]));
 return <section className={styles.breakdown} aria-label={"Problem results for " + row.alias}>
  <div className={styles.breakdownHeading}><Icon name="document" size={16}/><h3>Points by problem</h3><span>Published final scores</span></div>
  <ul className={styles.problemGrid}>{row.problems.map(result => {
   const problem = byId.get(result.competitionId);
   const scored = Boolean(problem?.resultsVisible && result.status === "SCORED" && result.score != null && Number.isFinite(result.score));
   const label = result.status === "SCORED" && !scored ? "Awaiting results" : resultLabels[result.status];
   return <li key={result.competitionId} className={scored ? styles.scoredProblem : ""}>
    <div className={styles.problemTitle}><h4>{problem?.title || "Problem result"}</h4>{problem?.competitionTitle && problem.competitionTitle !== problem.title && <small>{problem.competitionTitle}</small>}</div>
    <div className={styles.problemResult}><strong>{scored ? pointText(result.score!) : "—"}</strong><span className={scored ? styles.scoredStatus : styles.pendingStatus}>{scored ? "points" : label}</span></div>
   </li>;
  })}</ul>
  <p>Awaiting, missing, withheld and ineligible results add no points.</p>
 </section>;
}

export default function OverallLeaderboard({ data, loading = false, error, alias }: OverallLeaderboardProps) {
 const [query, setQuery] = useState("");
 const [filter, setFilter] = useState<Filter>("all");
 const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
 const id = useId();
 const rows = useMemo(() => {
  const search = query.trim().toLocaleLowerCase();
  return (data?.rows || []).filter(row => (!search || row.alias.toLocaleLowerCase().includes(search)) &&
   (filter === "all" || filter === "ranked" && isRanked(row) || filter === "awaiting" && awaitingCount(row) > 0));
 }, [data, query, filter]);
 if (!data) return <>{error && <Notice error>{error}</Notice>}<section className="card"><Empty icon="trophy" title={error ? "Overall standings unavailable" : "Loading overall standings"}>{error ? "Please refresh when the competition service is available." : "We are collecting published points across all problems."}</Empty></section></>;
 const leaders = data.rows.filter(row => row.rank === 1 && isRanked(row));
 const mine = alias ? data.rows.find(row => row.alias === alias) : undefined;
 const awaiting = data.rows.filter(row => awaitingCount(row) > 0).length;
 const ranked = data.rankedParticipants;
 return <div className={styles.board}>
  {error && <Notice error>{error}</Notice>}
  <div className={styles.summary}>
   <section className={styles.summaryCard + " " + styles.leaderCard}><span className={styles.summaryLabel}><Icon name="trophy" size={17}/>Overall leader</span><strong>{leaders.length ? leaders.map(row => row.alias).join(", ") : "Awaiting results"}</strong><small>{leaders.length ? pointText(leaders[0].totalPoints) + " total points" + (leaders.length > 1 ? " · shared first place" : "") : "A published eligible score is needed"}</small></section>
   <section className={styles.summaryCard}><span className={styles.summaryLabel}><Icon name="document" size={17}/>All problems</span><strong>{number(data.totalProblems)}</strong><small>{number(data.publishedProblems)} with published results</small></section>
   <section className={styles.summaryCard}><span className={styles.summaryLabel}><Icon name="people" size={17}/>Participants</span><strong>{number(data.totalParticipants)}</strong><small>{number(ranked)} ranked · {number(awaiting)} awaiting results</small></section>
  </div>
  {mine && <section className={styles.personal} aria-label="Your overall standing">
   <div className={styles.personalHeading}><Icon name="people" size={17}/><strong>Your overall standing</strong><span>{mine.alias}</span></div>
   <div className={styles.personalStats}>
    <div><span>Overall rank</span><strong>{isRanked(mine) ? formatRankingPosition(mine.rank) : "—"}</strong><small>{isRanked(mine) ? "of " + number(data.totalParticipants) + " participants" : awaitingCount(mine) ? "Awaiting results" : "No published eligible score"}</small></div>
    <div><span>Total points</span><strong title={"Exact total: " + mine.totalPointsExact}>{pointText(mine.totalPoints)}</strong><small>{mine.scoredProblems ? "Published eligible final scores" : "No published scores yet"}</small></div>
    <div><span>Scored problems</span><strong>{number(mine.scoredProblems)} <em>/ {number(mine.joinedProblems)}</em></strong><small>Across your joined problems</small></div>
    <div><span>Solved problems</span><strong>{number(mine.solvedProblems)}</strong><small>Fully correct published results</small></div>
   </div>
  </section>}
  <section className={"card " + styles.standings} aria-label="Overall standings across all problems">
   <div className={styles.heading}><div><h2>Overall standings</h2><p>Total points across all included problems.</p></div><div className={styles.headingBadges}><Badge tone="blue">Total points</Badge>{loading && <span className="spinner" aria-label="Refreshing overall standings"/>}</div></div>
   <div className={styles.rules}><Icon name="shield" size={16}/><span>Only published, eligible final scores count toward total points. Equal total points share the same rank.</span></div>
   <div className={styles.tools}>
    <div className={styles.search}><Icon name="people" size={15}/><input aria-label="Search overall participants" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search participants"/>{query && <button type="button" aria-label="Clear overall participant search" onClick={() => setQuery("")}><Icon name="close" size={14}/></button>}</div>
    <div className={styles.filters} role="group" aria-label="Filter overall standings">{([["all", "All", data.totalParticipants], ["ranked", "Ranked", ranked], ["awaiting", "Awaiting results", awaiting]] as const).map(([value, label, count]) => <button key={value} type="button" className={filter === value ? styles.filterActive : ""} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}<span>{number(count)}</span></button>)}</div>
   </div>
   {rows.length ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th scope="col">Overall rank</th><th scope="col">Participant</th><th scope="col">Total points</th><th scope="col">Solved problems</th><th scope="col">Results</th><th scope="col">Details</th></tr></thead><tbody>{rows.map(row => {
    const expanded = expandedUserId === row.userId, pending = awaitingCount(row);
    return <Fragment key={row.userId}><tr className={row.alias === alias ? styles.myRow : ""}>
     <td data-label="Overall rank"><span className={styles.position + " " + (row.rank === 1 ? styles.firstPosition : "")}>{formatRankingPosition(row.rank)}</span></td>
     <td data-label="Participant" className={styles.participant}><div><strong>{row.alias}</strong>{row.alias === alias && <span className={styles.you}>You</span>}</div><small className={isRanked(row) ? styles.rankedStatus : styles.pendingStatus}>{isRanked(row) ? "Ranked" : pending ? "Awaiting results" : "No published eligible score"}</small></td>
     <td data-label="Total points"><strong className={styles.points} title={"Exact total: " + row.totalPointsExact}>{pointText(row.totalPoints)}</strong><small>{row.scoredProblems ? "Published points" : "No published scores yet"}</small></td>
     <td data-label="Solved problems"><strong className={styles.count}>{number(row.solvedProblems)}</strong><small>Fully correct results</small></td>
     <td data-label="Results"><strong className={styles.resultsCount}>{number(row.scoredProblems)} / {number(row.joinedProblems)} scored</strong><small>{pending ? number(pending) + " awaiting results" : "Across joined problems"}</small></td>
     <td data-label="Details"><button type="button" className={styles.detailsButton} aria-expanded={expanded} aria-controls={id + "-results-" + row.userId} onClick={() => setExpandedUserId(expanded ? null : row.userId)}>{expanded ? "Hide problem results" : "View problem results"}<Icon name="arrow" size={13}/></button></td>
    </tr>{expanded && <tr className={styles.breakdownRow}><td colSpan={6} id={id + "-results-" + row.userId}><ProblemResults row={row} problems={data.problems}/></td></tr>}</Fragment>;
   })}</tbody></table></div> : <Empty icon={data.totalProblems ? "people" : "document"} title={data.rows.length ? "No participants match" : data.totalProblems ? "No participants yet" : "No problems yet"}>{data.rows.length ? "Try another name or select All to see every participant." : data.totalProblems ? "Participants appear after joining any included problem." : "Problems appear here when their competition opens."}</Empty>}
  </section>
 </div>;
}
