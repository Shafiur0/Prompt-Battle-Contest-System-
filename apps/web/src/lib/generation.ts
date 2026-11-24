import type { CompetitionView, TokenView } from "./views";
type GenerationCompetition = Pick<CompetitionView, "status" | "generationCutoff" | "modelReady" | "member" | "workspaceState" | "generationReservationTokens" | "moderationStatus" | "publicModerationNotice">;
export function generationBlockReason(competition: GenerationCompetition, account: TokenView | null, hasFinalSelection: boolean, now = Date.now()): string | null {
 if(competition.moderationStatus==="BANNED") return competition.publicModerationNotice||"Your participation is banned in this competition. New generation and final selection are blocked.";
 if(hasFinalSelection || competition.workspaceState !== "OPEN") return "This workspace is closed to new generations.";
 if(competition.status !== "GENERATION_OPEN") return competition.status === "DRAFT" ? "The organizer has not opened generation for this competition." : "Generation is closed for this competition.";
 if(competition.generationCutoff) {
  const deadline = Date.parse(competition.generationCutoff);
  if(!Number.isFinite(deadline)) return "The generation schedule is unavailable. Refresh the competition.";
  if(now >= deadline) return "The generation deadline has passed.";
 }
 if(!competition.member || !account) return "An enrolled participant account is required for generation.";
 if(!competition.modelReady) return "The AI connection is not ready yet.";
 if(account.state !== "OPEN") return "New generations are unavailable for this token account.";
 if(![account.allowance,account.confirmedUsed,account.reserved,account.available].every(value=>Number.isSafeInteger(value)&&value>=0)) return "Verified token balances are unavailable. Refresh the competition.";
 if(account.reserved > 0) return "A generation request is still reserved. Wait for its recorded outcome.";
 if(account.available <= 0) return "No tokens are currently available for another request.";
 const required = competition.generationReservationTokens;
 if(required !== undefined && (required === null || !Number.isSafeInteger(required) || required <= 0)) return "The generation reservation is unavailable. Refresh the competition.";
 if(typeof required === "number" && account.available < required) return "This request requires a reservation of "+required.toLocaleString("en-US")+" tokens; "+account.available.toLocaleString("en-US")+" are available.";
 return null;
}
export async function runGenerationAction(request: () => Promise<unknown>, handlers: { clearError: () => void; setSubmitting: (value: boolean) => void; reportError: (error: unknown) => void }): Promise<unknown> {
 handlers.clearError();
 handlers.setSubmitting(true);
 try { return await request(); }
 catch(error) { handlers.reportError(error); return null; }
 finally { handlers.setSubmitting(false); }
}
