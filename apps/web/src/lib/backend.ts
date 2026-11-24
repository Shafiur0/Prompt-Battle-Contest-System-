import type { ProblemEditorView, StructuredProblemDraft } from "./problem-editor-model";
import { api, ApiError } from "./api";
import type { AttemptView, CompetitionView, LeaderboardView, OverallLeaderboardView, OrganizerView, RegistryItemView, SessionView, SubmissionView, TokenView } from "./views";
import type { HumanDecisionInput } from "@/components/organizer";
import type { QualityReviewInput } from "@/components/quality-review";
const id = (value: string) => encodeURIComponent(value);
export const getSession = () => api<SessionView>("/session");
export async function getCompetitions() { const data=await api<{competitions:CompetitionView[]}>("/competitions"); if(!Array.isArray(data.competitions))throw new ApiError("The competition list could not be loaded.",502); return data.competitions; }
export const getCompetition = (competitionId:string) => api<CompetitionView>("/competitions/"+id(competitionId));
export async function getWorkspace(competitionId: string, authenticated: boolean) {
 const competition=await getCompetition(competitionId);
 if(!authenticated||!competition.member)return {competition,account:null,attempts:[] as AttemptView[],submission:null};
 const [account,history]=await Promise.all([api<TokenView>("/competitions/"+id(competitionId)+"/token-account"),api<{attempts:AttemptView[]}>("/competitions/"+id(competitionId)+"/attempts")]);
 if(!Array.isArray(history.attempts))throw new ApiError("Your attempt history could not be loaded.",502);
 const submission=competition.submissionId?await api<SubmissionView>("/submissions/"+id(competition.submissionId)):null;
 return {competition,account,attempts:history.attempts,submission};
}
export const getLeaderboard = (competitionId:string) => api<LeaderboardView>("/competitions/"+id(competitionId)+"/leaderboard");
export const getOverallLeaderboard = (includeSamples=false) => api<OverallLeaderboardView>("/leaderboard"+(includeSamples?"?includeSamples=true":""));
export const getOrganizer = (competitionId:string) => api<OrganizerView>("/organizer/competitions/"+id(competitionId));
export async function generateAttempt(competitionId:string,prompt:string,parentAttemptId:string|undefined,idempotencyKey:string) {
 const result=await api<{attemptId:string}>("/competitions/"+id(competitionId)+"/attempts",{method:"POST",json:{prompt,...(parentAttemptId?{parentAttemptId}:{})},idempotencyKey});
 if(!result.attemptId)throw new ApiError("The server did not return an attempt identity. Retry with the same prompt to recover your request.",502);
 return result.attemptId;
}
export async function selectFinal(competitionId:string,attemptId:string,idempotencyKey:string) { await api<{submissionId:string}>("/competitions/"+id(competitionId)+"/final-selections",{method:"POST",json:{attemptId},idempotencyKey}); }
export async function enrollParticipant(competitionId:string,_invitationCode:string,_rulesVersionId:string) { await api("/competitions/"+id(competitionId)+"/enroll",{method:"POST",json:{},idempotencyKey:crypto.randomUUID()}); }
export async function createAppeal(submissionId:string,reason:string) { await api("/submissions/"+id(submissionId)+"/appeals",{method:"POST",json:{reason},idempotencyKey:crypto.randomUUID()}); }
export async function recordDecision(_competitionId:string,data:HumanDecisionInput) { await api("/organizer/submissions/"+id(data.submissionId)+"/reviews",{method:"POST",json:{verdict:data.verdict,reason:data.reason,...(data.ruleId?{ruleId:data.ruleId}:{}),severity:data.severity||"NONE",...(data.appealId?{appealId:data.appealId}:{})},idempotencyKey:crypto.randomUUID()}); }
export async function saveRegistry(competitionId:string,items:RegistryItemView[]) { await api("/organizer/competitions/"+id(competitionId)+"/critical-registry/versions",{method:"POST",json:{items},idempotencyKey:crypto.randomUUID()}); }
export async function saveSchedule(competitionId:string,dates:{generationCutoff:string;selectionCutoff:string;revealAt:string}) { await api("/organizer/competitions/"+id(competitionId)+"/schedule",{method:"POST",json:dates}); }
export async function closeCompetition(competitionId:string) { await api("/organizer/competitions/"+id(competitionId)+"/close",{method:"POST",json:{}}); }
export async function publishCompetition(competitionId:string) { await api("/organizer/competitions/"+id(competitionId)+"/start",{method:"POST",json:{}}); }
export async function revealCompetition(competitionId:string) { await api("/organizer/competitions/"+id(competitionId)+"/reveal",{method:"POST",json:{}}); }

export async function recordQualityReview(submissionId:string,input:QualityReviewInput) { await api("/organizer/submissions/"+id(submissionId)+"/quality-review",{method:"POST",json:input,idempotencyKey:crypto.randomUUID()}); }

export async function createCompetition(title:string) { const result=await api<{competition:CompetitionView}>("/organizer/competitions",{method:"POST",json:{title},idempotencyKey:crypto.randomUUID()}); if(!result.competition?.id)throw new ApiError("The server did not return the new competition.",502); return result.competition; }

export const getProblemEditor=(competitionId:string)=>api<ProblemEditorView>("/organizer/competitions/"+id(competitionId)+"/problem");
export const saveProblemEditor=(competitionId:string,draft:StructuredProblemDraft)=>api<ProblemEditorView>("/organizer/competitions/"+id(competitionId)+"/problem",{method:"POST",json:draft,idempotencyKey:crypto.randomUUID()});

export const deleteProblemEditor=(competitionId:string)=>api<{ok:true}>("/organizer/competitions/"+id(competitionId)+"/problem",{method:"DELETE"});
export const getOwnerAnnouncements=(competitionId:string)=>api<{announcements:import("./views").AnnouncementView[]}>("/organizer/competitions/"+id(competitionId)+"/announcements");
export const getMemberAnnouncements=(competitionId:string)=>api<{announcements:import("./views").AnnouncementView[]}>("/competitions/"+id(competitionId)+"/announcements");
export const postAnnouncement=(competitionId:string,message:string)=>api("/organizer/competitions/"+id(competitionId)+"/announcements",{method:"POST",json:{message},idempotencyKey:crypto.randomUUID()});
export const withdrawAnnouncement=(competitionId:string,announcementId:string)=>api("/organizer/competitions/"+id(competitionId)+"/announcements/"+id(announcementId),{method:"DELETE"});
export const getParticipantDetail=(competitionId:string,participantId:string)=>api<import("./views").ParticipantDetailView>("/organizer/competitions/"+id(competitionId)+"/participants/"+id(participantId));
export const moderateParticipant=(competitionId:string,participantId:string,action:"ban"|"unban",body:{reason:string;publicNotice:string;confirmedFinding?:string})=>api("/organizer/competitions/"+id(competitionId)+"/participants/"+id(participantId)+"/"+action,{method:"POST",json:body,idempotencyKey:crypto.randomUUID()});
