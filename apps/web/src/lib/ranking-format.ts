import type { LeaderboardView } from "./views";
export type RankingRow = LeaderboardView["rows"][number];
export type RankingFilter = "all" | "solved" | "pending";
export type RankingOrder = "overall" | "solved";

export function formatCompletionTime(milliseconds?: number | null): string {
 if (milliseconds == null || !Number.isFinite(milliseconds) || milliseconds < 0) return "—";
 if (milliseconds > 0 && milliseconds < 1000) return "Under 1s";
 let seconds = Math.floor(milliseconds / 1000);
 const units: string[] = [];
 for (const [size, label] of [[86400, "d"], [3600, "h"], [60, "m"]] as const) {
  const amount = Math.floor(seconds / size); seconds %= size;
  if (amount) units.push(amount + label);
 }
 if (seconds || !units.length) units.push(seconds + "s");
 return units.join(" ");
}
export function formatRankingPosition(position?: number | null): string {
 return position != null && Number.isSafeInteger(position) && position > 0 ? "#" + position : "—";
}
export function rankingResultsVisible(data: LeaderboardView | null | undefined): boolean {
 if (!data) return false;
 if (typeof data.resultsVisible === "boolean") return data.resultsVisible;
 return data.rows.some(row => row.score != null);
}
export function isRankedResult(row: RankingRow): boolean {
 return row.status.toUpperCase() !== "BANNED" && row.score != null && formatRankingPosition(row.rank) !== "—";
}
export function rankingStatus(row: RankingRow, resultsVisible: boolean): string {
 const state = row.status.toUpperCase();
 if (state === "BANNED") return "Ranking withheld";
 if (state === "NO_SUBMISSION") return "No final answer";
 if (!resultsVisible) return "Results pending";
 if (row.eligible === false && row.score != null) return "Not eligible";
 if (isRankedResult(row)) return "Ranked";
 return "Evaluation pending";
}
export function rankingViewRows(rows: RankingRow[], options: {query?:string;filter?:RankingFilter;order?:RankingOrder;resultsVisible:boolean}): RankingRow[] {
 const query = (options.query || "").trim().toLocaleLowerCase("en-US");
 const result = rows.filter(row => {
  if (query && !row.alias.toLocaleLowerCase("en-US").includes(query)) return false;
  if (options.filter === "solved") return options.resultsVisible && formatRankingPosition(row.solveOrder) !== "—";
  if (options.filter === "pending") return (!options.resultsVisible || row.score == null) && !["BANNED", "NO_SUBMISSION"].includes(row.status.toUpperCase());
  return true;
 });
 if (options.order === "solved" && options.resultsVisible) {
  result.sort((left, right) => {
   const l = formatRankingPosition(left.solveOrder) === "—" ? Infinity : left.solveOrder!;
   const r = formatRankingPosition(right.solveOrder) === "—" ? Infinity : right.solveOrder!;
   return l === r ? 0 : l < r ? -1 : 1;
  });
 }
 return result;
}
export function firstCorrectSolvers(data: LeaderboardView): string[] {
 if (!rankingResultsVisible(data)) return [];
 if (data.firstSolverAliases?.length) return [...data.firstSolverAliases];
 if (data.firstSolverAlias) return [data.firstSolverAlias];
 return data.rows.filter(row => row.solveOrder === 1).map(row => row.alias);
}