export interface SessionView { authenticated: boolean; user: { id: string; alias: string } | null; roles: string[]; }
export interface CompetitionView {
 id: string; title: string; status: string; reviewMode?:string;rankingMode?:string;problemRevision?:number|null;problemVersionId?:string; capacity: number; participantCount: number;
 problemKind?: string; outputSchema?: Record<string,unknown>; problemTitle: string; problemStatement: string; outputContract: string; copyingPolicy: string; penaltySchedule: string;
 generationModel: string; qualityModel: string; reviewerModel: string; generationCutoff?: string | null; selectionCutoff?: string | null; revealAt?: string | null;
 rulesVersionId: string; tokenBudget: number; modelReady: boolean; modelStatusText: string; generationReservationTokens?: number | null; member: boolean; moderationStatus?: "ACTIVE"|"BANNED"; publicModerationNotice?: string|null; problemDeleted?: boolean; workspaceState: string; submissionId?: string | null;
}
export interface TokenView { allowance: number; confirmedUsed: number; reserved: number; available: number; state: string; }
export interface AttemptView { id: string; version: number;problemRevision?:number|null;problemVersionId?:string|null;problemTitle?:string|null;problemStatement?:string|null; prompt: string; status: string; answer: string | null; inputTokens: number | null; outputTokens: number | null; totalTokens: number | null; createdAt: string; canSelect: boolean; publicTests: Array<{name: string; passed: boolean; detail: string}>; evaluationSummary?: string | null; }
export interface ScoreView { copyingPenalty?:number;penaltySource?:string;problemRevision?:number|null;problemVersionId?:string|null;solveElapsedMs?:number|null;firstCorrectAt?:string|null; finalScore: number; quality: number; correctness: number; critical: number; judge: number; efficiency: number; tokenUsage: number; eligible: boolean; }
export interface SubmissionView { id: string; attemptId: string; status: string; score: ScoreView | null; integrityNotice?: { reason: string; penalty: number;source?:string;ruleIds?:string[] } | null; }
export interface RankingPositionView {rank:number|null;solveOrder:number|null;eligible?:boolean|null;totalParticipants:number;solveElapsedMs:number|null;firstCorrectAt?:string|null;}
export interface LeaderboardView { mode: string;rankingMode?:string;resultsVisible?:boolean;totalParticipants?:number;rankedParticipants?:number;solvedParticipants?:number;firstSolverAlias?:string|null;firstSolverAliases?:string[]; rows: Array<{participantId?:string;solveOrder?:number|null;eligible?:boolean|null;rank: number | null; alias: string; status: string; score: number | null; quality?: number | null; correctness?: number | null; tokens: number | null;copyingPenalty?:number|null;penaltySource?:string|null;efficiency?:number|null;solveElapsedMs?:number|null;firstCorrectAt?:string|null;problemRevision?:number|null;problemVersionId?:string|null}>; }
export interface RegistryItemView { id: string; category: string; text?: string; explanation?: string; publicRuleId?: string; severity?: string; }
export interface ReviewCaseView { submissionId: string; alias: string; attemptId: string; prompt: string; answer: string | null; status: string;automaticReview?:boolean;problemRevision?:number|null;problemVersionId?:string|null;problemTitle?:string|null;problemStatement?:string|null;score?:ScoreView|null;solveElapsedMs?:number|null; humanFallbackAvailable?: boolean; evidenceReady?: boolean; contextualFailure?: string|null; copyEvidence?: Array<{quote:string;sourceQuote?:string;ruleId?:string;classification?:string;promptStartByte?:number;promptEndByte?:number;sourceStartByte?:number;sourceEndByte?:number}>; solutionEvaluation?: { C: number; K: number; J: number | null; eligible: boolean }; qualityReviewRequired?: boolean; review: { verdict: string; reason: string; evidence: Array<{quote: string; sourceQuote?: string; ruleId?: string; classification?: string}> } | null; decision: { verdict: string; reason: string; penalty: number;source?:string;ruleIds?:string[] } | null; appeal?: { id: string; reason: string; status: string } | null; }
export interface OrganizerView { ranking?:LeaderboardView;competition: CompetitionView; participants: Array<{id: string; alias: string; usedTokens: number; reservedTokens: number; state: string; moderationStatus?: "ACTIVE"|"BANNED"; publicModerationNotice?: string|null; submissionId?: string | null}>; registry: { versionId: string; items: RegistryItemView[] }; cases: ReviewCaseView[]; closed: boolean; modelStatus: { ready: boolean; reason: string; generationModel: string; judgeModel: string; reviewerModel: string; qualification?: string }; }

export interface AnnouncementView { id:string;message:string;createdAt:string;withdrawn:boolean; }
export interface ParticipantDetailView { ranking?:RankingPositionView|null;id:string;alias:string;workspaceState:string;moderationStatus:"ACTIVE"|"BANNED";publicModerationNotice:string|null;evaluation?:{verdict?:string;reason?:string;penalty?:number;source?:string;ruleIds?:string[];score?:ScoreView|null;solveElapsedMs?:number|null;firstCorrectAt?:string|null}|null;wallet:TokenView;submissionId:string|null;historyAvailable:boolean;attempts:Array<{id:string;version:number;status:string;inputTokens:number|null;outputTokens:number|null;totalTokens:number|null;createdAt:string;prompt?:string;answer?:string|null}>; }

export interface OverallLeaderboardView {
 scope: "ALL_PROBLEMS";
 scoring: "TOTAL_POINTS";
 includeSamples: boolean;
 totalProblems: number;
 publishedProblems: number;
 totalParticipants: number;
 rankedParticipants: number;
 problems: Array<{ id: string; title: string; competitionTitle: string; status: string; resultsVisible: boolean }>;
 rows: Array<{
  userId: string;
  alias: string;
  rank: number | null;
  totalPoints: number;
  totalPointsExact: string;
  joinedProblems: number;
  scoredProblems: number;
  solvedProblems: number;
  problems: Array<{ competitionId: string; score: number | null; status: "SCORED" | "PENDING" | "NO_SUBMISSION" | "NOT_JOINED" | "BANNED" | "INELIGIBLE" }>;
 }>;
}
