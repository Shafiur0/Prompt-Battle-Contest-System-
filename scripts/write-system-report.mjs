import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd(),base=path.join(root,'.local/system-tests');
const currentDir=path.join(base,'2026-11-21T07-36-27-205Z'),priorDir=path.join(base,'2026-11-20T21-54-21-554Z');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const audit=read(path.join(currentDir,'audit.json')),run=read(path.join(currentDir,'run.json')),prior=read(path.join(priorDir,'audit.json'));
if(!audit.ok||audit.failures.length||audit.pending.length||run.status!=='BROWSER_WORKFLOW_PASSED')throw new Error('Final test evidence is not complete');
const rows=[...audit.participants].sort((a,b)=>Number(a.alias.replace('participant',''))-Number(b.alias.replace('participant','')));
const table=rows.map(p=>`| ${p.alias} | ${p.scenario} | ${p.versions} / ${p.selectedVersion} | ${p.confirmedUsed} | ${p.machineVerdict} | ${p.humanPenalty} | ${p.finalScore.toFixed(4)} | ${p.moderation==='BANNED'?'Banned; rank withheld':p.eligible?'Eligible':'Ineligible'} |`).join('\n');
const cost=audit.summary.knownReportedCostUsd+prior.summary.knownReportedCostUsd;
const text=`# Local system test report

Completed 21 November 2026. The corrected ten-participant exercise and its read-only accounting/evidence audit passed. The application remains a local calibration deployment; this report does not certify perfect AI judgment or production qualification.

## Tested environment and evidence

- Application: http://localhost:3000; API: http://localhost:4000/api/v1.
- Actual Chrome sessions authenticated through Keycloak: one organizer and participant1 through participant10. Each enrolled participant had a separate 2,000,000-token generation wallet.
- Corrected competition: **${audit.title}**; ID **${audit.competitionId}**.
- Final state: **${audit.status}**. Ten immutable final selections; eleven generation versions. Participant10 generated twice and selected version1; both versions counted.
- Generator: DeepSeek \`deepseek/deepseek-v4.1-flash-1017\`, fixed Fireworks provider through OpenRouter.
- Independent integrity reviewer and separate solution-quality calls: \`anthropic/claude-sonnet-5.5\`, Anthropic provider through OpenRouter.
- Synthetic six-times-seven problem, explicit nonessential protected commentary, public required facts/output schema, private mathematical check and reference. This was QA data, not genuine participant misconduct.
- Participant prompts were supplied through the visible editor; generated answers were never edited. Human adjudications in this test were explicit synthetic administrative decisions based on the fixture/evidence, not automatic AI penalties.

The private checkpoints and read-only reports are retained in [run.json](.local/system-tests/2026-11-21T07-36-27-205Z/run.json) and [audit.json](.local/system-tests/2026-11-21T07-36-27-205Z/audit.json). They contain synthetic prompt/answer evidence. They contain no configured provider key. Do not publish raw operational logs or authentication artifacts.

## Final verification results

| Check group | Result |
|---|---|
| Backend/API and real PostgreSQL regressions | 57 passed |
| Scoring, registry, matching and structured-problem tests | 49 passed |
| OpenRouter request/usage/failure tests | 19 passed |
| Participant generation and problem editor UI logic | 13 passed |
| Total automated checks | **138 passed** |
| Complete production build | Passed |
| Ten browser logins, enrollments, generation and final selections | Passed |
| Organizer create/edit/remove/restore problem through visible controls | Passed |
| Announcement publish/withdraw through visible controls | Passed |
| All ten individual participant drawers | Passed against server wallets/history |
| Visible human-confirmed ban and unban dialogs | Passed |
| Read-only receipt/ledger/evidence/score audit | Passed; no failures or pending records |

The backend tests use isolated PostgreSQL fixture schemas. Provider failure/usage-recovery tests use explicit mocked receipts; they do not pretend to be live outages.

## Generation token reconciliation

The corrected round made **11 generation calls**, **20 quality calls** and **10 integrity calls**, all with retained usage receipts. There were no contextual retries in the corrected run.

- Generation input: **${audit.summary.generationInputTokens}** tokens.
- Generation output: **${audit.summary.generationOutputTokens}** tokens.
- Participant generation total: **${audit.summary.generationTotalTokens}** tokens.
- All ten final wallet reservations: **0**. No unresolved generation calls.
- Organizer quality/reviewer usage: **${audit.summary.organizerTokens}** tokens. It did not affect participant balances or efficiency.
- Cached-input and reasoning-output subsets were already included in their receipt totals and were not added again.
- Provider-reported cost for this corrected round: **USD ${audit.summary.knownReportedCostUsd.toFixed(8)}**, about $${audit.summary.knownReportedCostUsd.toFixed(2)}. This is receipt evidence, not a replacement for the provider's final billing statement.

For every participant, stored generation receipts equaled the confirmed wallet and cumulative ledger deltas. The final token snapshot included every generation version, including the unselected second answer. Reservations were not refunded by bans. A real PostgreSQL concurrency regression also proved that the tenth seat is allocated once and an eleventh valid invite receives no wallet.

| Participant | Scenario | Generated versions / selected | Generation tokens | AI recommendation | Human deduction | Stored score | Award state |
|---|---|---:|---:|---|---:|---:|---|
${table}

For example, participant1's C=1, K=1 and J=0.8 produce Q=0.96 and score96. Participant2 had the same base score; a human-approved MINOR deduction of1 produced95. The later ban withheld award rank while retaining the score and token records. All test usage was below the 10,000-token efficiency reference, so efficiency saturated; high-usage arithmetic and quality gating were verified separately by regression tests.

## Reviewer outcome and fairness

The corrected instruction-prepared reviewer returned **10/10 valid structured reports**:

- Four **POSSIBLE_VIOLATION** recommendations: full copy, whitespace-formatted copy, partial copy, and original instructions surrounding a protected copy.
- Six **NO_VIOLATION** recommendations for original/manual instructions, required facts, common terms and non-copying controls.
- Deterministic source/prompt evidence reproduced for the exact selected versions and the frozen registry. The server assembled identities, metrics and byte ranges; the model could not confirm guilt or set numeric penalties.
- Every case received human sign-off. Only the four explicitly inspected protected-copy fixtures received the published one-point deduction.
- No integrity review or deterministic copying scan ran before whole-competition closure. No active participant copying warnings or hints were introduced.

This is ten synthetic cases under one problem/policy, not a held-out multilingual benchmark. It demonstrates the observed distinctions and valid contracts, not perfect detection of every possible attack or external assistance. The reviewer is **instruction-prepared**, not platform-fine-tuned; no training claim is made.

## Admin and participant workflow checks

1. An organizer added a structured problem and private reference, edited its version, logically removed it, verified publication was blocked, and restored a new active version. Published edit/delete requests were rejected. The visible UI was tested separately in an isolated draft.
2. All ten enrolled participants read the operational announcement. Participant attempts to publish announcements or read organizer participant detail were rejected. Withdrawal removed the active notice and retained owner history.
3. Before closure, organizer individual-state APIs exposed metadata without prompt/answer content. After closure, all ten UI drawers showed the matching allowance, usage, reservation, final-choice and version counts.
4. A temporary pre-selection ban blocked generation and selection without changing usage. Unban preserved the stored answer and allowed the second version. It did not reopen any sealed workspace.
5. Cross-user answer access and forged answer/token/score request fields were rejected.
6. Final choices used browser confirmation controls and remained immutable.
7. The partial-copy case appealed. An inconclusive successor decision kept the appeal open and hid its stale score. A final decision using the same appeal ID resolved the appeal and published a new score revision.
8. A confirmed full-copy test entry was banned after review, lost its rank and retained its history. The actual admin unban/reban dialogs were tested with mandatory reasons, human finding and confirmation.

## Problems found and fixed

| Finding | Correction and evidence |
|---|---|
| CLI fill truncated multiline QA input at the first newline | Use a real Playwright field-fill action for multiline input; check exact browser text and exact stored prompt. The corrected round exercised all intended prompts. The previous immutable round was preserved. |
| Reviewer invented or mismatched allowed-fact evidence links | Added explicit registry-to-evidence guidance and server-provided valid links in instruction package v2. Strict rejection remains; no fabricated ID is repaired into valid evidence. Corrected run needed no retry or human fallback. |
| Human fallback lacked inspectable deterministic evidence in the admin DTO | Post-closure admin view now includes retained copy evidence, readiness and failure provenance even without a validated machine report. Pending cases cannot record a decision prematurely. Regression passed. |
| Inconclusive appeal could resolve prematurely | It stays OPEN until a final successor; stale score/notice remains hidden. Real database workflow regression passed. |
| Historical-table trigger installation checked names across all schemas | Added target-table/schema binding. Existing public-schema trigger names had prevented eight battle-table guards from installing. Guards were installed without changing record content. A real collision regression and final audit passed. |
| New object digests could fail replay after JSONB key reordering | Canonical sorted-key digests and version tags preserve replay for new records; legacy/string/request hashes remain compatible. All82 corrected-round request/response digests replayed. |

The same tests also retained previous fixes for UUID/text admission parameters, single evaluation claims, full prompt byte bounds, provider usage preservation and exact qualified-manifest matching.

## First test round: preserved failure evidence and costs

The first round **5a08b128-dc70-4a90-adbe-0dca032c49a1** had four truncated multiline prompts. Its copying coverage failed, and the backend correctly rejected an unsupported confirmation. Six contextual runs exhausted their bounded schema/evidence retries; four reports were valid. No generation was resent or historical answer rewritten.

After inspecting the actual retained prompts, all ten first-round cases received no-violation decisions. That round was resolved and revealed with its original usage intact. Its audit still reports the eight input/scenario coverage failures; it is not labeled a successful copying test.

The first round recorded ${prior.summary.generationTotalTokens} generation tokens, ${prior.summary.organizerTokens} organizer tokens, ${prior.summary.generationCalls+prior.summary.qualityCalls+prior.summary.integrityCalls} provider calls and USD ${prior.summary.knownReportedCostUsd.toFixed(8)} in reported cost. Across both full model exercises, reported cost totaled **USD ${cost.toFixed(8)}**, about **$${cost.toFixed(2)}**. The isolated admin drafts made no AI calls. Earlier unrelated verification calls are outside this scoped total.

## Limits and remaining qualification

- The intentional numeric wrong-answer control was generated and correctly made ineligible.
- The intentional string result in participant9's prompt was corrected by the fixed generation/schema configuration to an integer. Its live invalid-format negative control was not exercised. Independent schema/format regression tests rejected invalid answers; no invalid output was fabricated.
- Human quality fallback, missing usage, ambiguous network failures and reservation boundaries were tested through controlled fixtures; the corrected live round did not experience those outages.
- The local appeal API enforces reveal/ownership and one open appeal per case; an automatic appeal-expiry deadline is not implemented. This is documented in the usage guide.
- No participant spent the full two-million-token allowance; boundary/concurrency tests validated the cap without wasting provider credits.
- This was a functional ten-session local test, not a long-duration soak test, high-load benchmark, full penetration test, or comprehensive adversarial/multilingual reviewer qualification.
- Official provider counting bounds, usage recovery approval, reviewer/quality benchmark evidence and production deployment hardening remain separate. **UNVERIFIED_CALIBRATION** remains explicit.
- Existing user competitions and their content, prompts, answers and wallets were not rewritten. Installation of missing history guards protects retained records.

## How to use the system now

Open **http://localhost:3000**. The completed SYSTEM TEST rounds are closed; create a new competition to begin another round. Use **Organizer → Problem** to configure the task, **Information registry** to set public reuse rules and schedule, then publish. Participants join, manually write prompts, generate answers and lock one final choice. Close the whole competition, inspect all human reviews, resolve any fallback/appeal, and reveal finalized results.

The complete account, setup, problem authoring, generation, admin, review and troubleshooting instructions are in [USER_GUIDE.md](USER_GUIDE.md).

Screenshots: [problem editor](output/playwright/admin-problem-editor.png), [announcements](output/playwright/admin-announcements.png), [participant wallet/history](output/playwright/admin-individual-participant.png), [moderation table](output/playwright/admin-ten-participant-status.png), and [integrity evidence](output/playwright/admin-integrity-evidence.png).

## Repeat verification

Routine checks use \`npm test\`, the two isolated web test commands documented below, and \`npm run build\`.

\`\`\`powershell
node --test apps/web/tests/generation.test.mjs
node --test apps/web/tests/problem-editor.test.mjs
\`\`\`

\`node scripts/system-e2e.mjs --live-ai\` creates a new synthetic competition and makes paid model calls. It must not be used as a blind retry of an interrupted generation. \`node scripts/run-system-audit.mjs --run .local/system-tests/<run-directory>\` reconciles an existing designated test round using a read-only transaction and does not call any model. Keep the injected database connection private.
`;
fs.writeFileSync(path.join(root,'SYSTEM_TEST_REPORT.md'),text);
console.log(JSON.stringify({report:'SYSTEM_TEST_REPORT.md',correctedAuditPassed:true,automatedChecks:138,totalReportedTestCostUsd:cost}));