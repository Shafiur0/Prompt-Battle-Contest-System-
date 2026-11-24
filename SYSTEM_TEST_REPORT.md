# Local system test report

## Participant sign-in recovery — 22 November 2026

Nine real-database auth regressions passed, including separate flow cookies, state-bound atomic consumption, missing/expired/replayed attempts, concurrency, wrong-issuer failure and prevention of an old organizer session masking a failed participant attempt. Five fresh-profile browser checks passed in `.local/signin-tests/2026-11-22T16-18-05-386Z/run.json`: 127.0.0.1 canonicalizes to localhost before the cookie is issued, participant1 receives the participant role/workspace, simultaneous attempts retain separate cookies, expired callbacks show a retry notice, and Restart login allows participant2 to sign in correctly. The API and web builds passed. No credentials were changed and no paid model calls were made.


## One-page organizer update — 22 November 2026

The organizer section tabs, quick-action cards and organizer sidebar were removed. The current problem, participant ranking/actions and message composer share one page; editing uses one Save form. Web typecheck, production build and 29 web checks passed. Nine browser workflows passed in `.local/one-page-organizer/2026-11-21T22-08-49-430Z/run.json`; its final announcement locator failed because snapshot whitespace was normalized. Cleanup restored the draft, cleared the synthetic ban and withdrew the notice. The isolated remaining publish/withdraw check passed in `.local/one-page-organizer/2026-11-22T05-34-54-902Z/run.json`. No paid model calls were made. Final screenshots: `output/playwright/one-page-organizer-desktop.png` and `output/playwright/one-page-organizer-mobile.png`.


## Organizer control center and clear rankings — 22 November 2026

The completed organizer interface and shared rankings passed **174 automated tests**, the complete production build and **nine real-Chrome workflow checks**. This UI exercise made no paid AI generation or evaluation calls. Evidence: [run.json](.local/organizer-ui/2026-11-21T21-20-59-038Z/run.json), status **PASSED**. The UTC evidence ID begins on 21 November; the user-facing date is 22 November in Dhaka.

| Automated group | Passed |
|---|---:|
| API/backend, including isolated real PostgreSQL workflows | 73 |
| Core domain, scoring, structured checks and evidence | 53 |
| OpenRouter request/accounting/failure handling | 19 |
| Web authoring, generation and ranking presentation logic | 29 |
| Total | **174** |

The nine observed browser checks established:

1. All six organizer sections are visible: **Overview, Problems, Participants, Announcements, Results, Settings**.
2. Problems provides selection/search plus **Edit problem / Add problem**, **View statement** and **Delete problem**. Editing saved a new version, and leaving unsaved work triggered the keep/discard guard.
3. A separate unpublished test draft (**331c8eb2-6714-4d7a-a56c-02eddd0e5330**) was deleted and restored through visible controls. Published deletion stays unavailable and explained.
4. Organizer and public standings listed every participant and separated overall rank from the recorded solving order. Switching **Solved first** changed the view without changing overall positions.
5. Individual participant inspection exposed the permitted progress, rank, evaluation, usage and history data for all ten entries.
6. Direct manual Ban/Unban controls were exercised on synthetic participant1 in a retained test round. The participant returned to ACTIVE and token usage stayed unchanged.
7. The dedicated announcement composer published a notice to the test competition.
8. The participant received the notice, and personal workspace/Leaderboard ranks agreed. The first correct solver was displayed separately from the overall leader.
9. Withdrawal removed the participant notice while retaining organizer announcement history.

Desktop and mobile screenshots are retained in [organizer-control-center.png](output/playwright/organizer-control-center.png), [clear-rankings.png](output/playwright/clear-rankings.png) and [organizer-mobile.png](output/playwright/organizer-mobile.png).

The ranking display consumes server positions and eligibility rather than regrading answers. Scores and solving positions stay hidden before permitted public release; organizers can inspect their private post-closure projection. Missing historical timing is labeled **Not recorded**. Overall rank stays score-first, while solving order explicitly answers who completed a fully correct answer first. These UI checks do not replace the earlier live-model/accounting evidence or certify official provider/reviewer qualification.

## Earlier verification snapshots
Final production restart check: application health was ready with the database connected. Chrome showed all ten leaderboard columns and the automatic participant3 details (1-point penalty, 312 generation tokens, original task revision 2, server completion time), with no human sign-off button. The leaderboard screenshot is saved at `output/playwright/automatic-leaderboard.png`.

## Clean problem editor update — 22 November 2026

The three-step editor and searchable competition selector passed the production web build, TypeScript checks and 23 web tests. A separate unpublished verification draft was created and saved through Chrome using plain fields. The browser checks verified invalid-number feedback, preserved line breaks, private reference separation, reloading a saved simple setup, keyboard search, hidden test rounds and mobile rendering. No AI generation or judging calls were made for this UI check. Screenshots are saved in `output/playwright/friendly-problem-editor.png` and `output/playwright/friendly-problem-mobile.png`. Existing complex answer rules remain available through Advanced setup.

## Current automatic system — 22 November 2026, Asia/Dhaka

The recovered implementation passed the complete automatic ten-participant exercise. The application is available at [http://localhost:3100](http://localhost:3100), with API http://localhost:4000/api/v1. This verifies local calibration behavior; it does not certify perfect model decisions or production qualification.

Evidence is retained in [run.json](.local/system-tests/2026-11-21T19-01-24-139Z/run.json) and [audit.json](.local/system-tests/2026-11-21T19-01-24-139Z/audit.json). The UTC run ID begins on 21 November; the exercise occurred on 22 November in Dhaka. Competition ID: **6b4298e1-0ffb-443e-9d90-08e6232d74f4**. Title: **SYSTEM TEST · Automatic ten participant exercise · 2026-11-21T19-01-24-139Z**. These are synthetic QA cases, not findings against real contestants.

### Verification results

| Check group | Result |
|---|---|
| Domain, scoring, registry, matching and structured-problem tests | 53 passed |
| API/backend and isolated real PostgreSQL regressions | 65 passed |
| OpenRouter request, usage and failure tests | 19 passed |
| Participant generation and problem-editor UI logic | 13 passed |
| Total automated tests | **150 passed** |
| Complete production build | Passed |
| Database migration | Passed |
| One organizer and ten independent Chrome participant logins | Passed |
| Eleven real generations, ten immutable final selections | Passed |
| Automatic review, deduction, quality and score publication without human sign-off | Passed |
| Automatic frozen-rule appeal with retained predecessor reports/decisions | Passed |
| Original, live-edited and closed-edited problem versions preserve their own answers/checks | Passed |
| Individual organizer details and participant result views for all ten entries | Passed |
| Receipt, ledger, evidence, revision, timing and ranking audit | **120 checks passed; no failures or pending records** |

The live exercise used fixed DeepSeek generation and separate Claude Sonnet quality/reviewer calls through OpenRouter. The audit recorded **11 automatic policy decisions and 11 review reports**: ten initial cases and one appeal successor. There was no human copying or quality decision in this automatic round.

### Accounting and observed copying decisions

| Metric | Recorded total |
|---|---:|
| Enrolled participants | 10 |
| Generation requests | 11 |
| Participant generation tokens | **2,539** |
| Organizer quality/reviewer tokens | **96,593** |
| Retained problem revisions | 4 |
| Provider-reported known cost | **USD 0.294002034**, about # Local system test report

## Organizer control center and clear rankings — 22 November 2026

The completed organizer interface and shared rankings passed **174 automated tests**, the complete production build and **nine real-Chrome workflow checks**. This UI exercise made no paid AI generation or evaluation calls. Evidence: [run.json](.local/organizer-ui/2026-11-21T21-20-59-038Z/run.json), status **PASSED**. The UTC evidence ID begins on 21 November; the user-facing date is 22 November in Dhaka.

| Automated group | Passed |
|---|---:|
| API/backend, including isolated real PostgreSQL workflows | 73 |
| Core domain, scoring, structured checks and evidence | 53 |
| OpenRouter request/accounting/failure handling | 19 |
| Web authoring, generation and ranking presentation logic | 29 |
| Total | **174** |

The nine observed browser checks established:

1. All six organizer sections are visible: **Overview, Problems, Participants, Announcements, Results, Settings**.
2. Problems provides selection/search plus **Edit problem / Add problem**, **View statement** and **Delete problem**. Editing saved a new version, and leaving unsaved work triggered the keep/discard guard.
3. A separate unpublished test draft (**331c8eb2-6714-4d7a-a56c-02eddd0e5330**) was deleted and restored through visible controls. Published deletion stays unavailable and explained.
4. Organizer and public standings listed every participant and separated overall rank from the recorded solving order. Switching **Solved first** changed the view without changing overall positions.
5. Individual participant inspection exposed the permitted progress, rank, evaluation, usage and history data for all ten entries.
6. Direct manual Ban/Unban controls were exercised on synthetic participant1 in a retained test round. The participant returned to ACTIVE and token usage stayed unchanged.
7. The dedicated announcement composer published a notice to the test competition.
8. The participant received the notice, and personal workspace/Leaderboard ranks agreed. The first correct solver was displayed separately from the overall leader.
9. Withdrawal removed the participant notice while retaining organizer announcement history.

Desktop and mobile screenshots are retained in [organizer-control-center.png](output/playwright/organizer-control-center.png), [clear-rankings.png](output/playwright/clear-rankings.png) and [organizer-mobile.png](output/playwright/organizer-mobile.png).

The ranking display consumes server positions and eligibility rather than regrading answers. Scores and solving positions stay hidden before permitted public release; organizers can inspect their private post-closure projection. Missing historical timing is labeled **Not recorded**. Overall rank stays score-first, while solving order explicitly answers who completed a fully correct answer first. These UI checks do not replace the earlier live-model/accounting evidence or certify official provider/reviewer qualification.

## Earlier verification snapshots
The 21 November exercise below is historical verification of the earlier human-review mode at port 3000. The current application uses port3100, automatic copying decisions and preserved problem revisions. Current implementation rules are documented in README.md and ARCHITECTURE.md section28; this historical run does not verify those later changes.

.29 |
| Final generation reservations | 0 |

Every retained generation receipt reconciled with the wallet/ledger and final token snapshot. The extra generated branch counted even though an earlier answer remained in history. Organizer evaluation usage did not reduce participant generation balances. The reported cost is receipt evidence, not a replacement for the final provider billing statement.

The reviewer distinguished protected nonessential commentary from reusable facts and common terminology. Full copy, whitespace-formatted copy, partial copy and original instructions surrounding a protected copy (participants 2, 3, 4 and 7) each received the frozen MINOR deduction of **1 point** automatically. The other six entries received **0**. The MATERIAL **3-point** branch was covered by isolated real-database/backend regressions rather than this live MINOR-only fixture. No pre-closure copying scan, warning or hint was introduced.

### Preserved revisions and correct-completion ranking

The original public mathematical task required 6×7=42. While the competition was open, the organizer saved a new revision requiring 8×7=56. Participant10 generated a second branch for that new revision. After closure, the organizer saved 9×7=63. Original answers continued to be evaluated against 42, and the selected new-revision answer against 56; the current 63 task did not change either result.

All records retained original problem/schema/check/registry bindings. Editing did not reopen a workspace, reset a wallet or rewrite a final answer. The read-only audit verified this across the four retained revision records.

The live results exercised **six same-version exact-score tie pairs**. Server receipt of the earliest fully correct answer broke equal scores before the remaining quality/correctness/token ties. The selected revision alone supplied completion evidence. The numeric wrong-answer control (participant8) had C=1/6, K=1 and **no correct-completion time**, demonstrating that eligibility/partial credit is insufficient. A different task revision cannot supply an earlier time. Timing added no score points.

### Limits and retained failure evidence

One honest warning remains: the generator corrected the deliberately malformed participant9 control to a valid integer response, so that live invalid-format negative case was not exercised. Isolated schema/format regressions cover malformed answers; no invalid live answer was fabricated.

Initial browser startup encountered an ENOSPC failure before any provider call. The run preserves this failure as resolved; it is not counted as a paid model attempt or a failed contestant answer. The completed run status is AUTOMATIC_BROWSER_WORKFLOW_PASSED and the audit reports ok=true.

This was a ten-session local functional exercise under one synthetic task/policy, not a long-duration load test, comprehensive adversarial/multilingual reviewer benchmark, provider token-bound qualification or public-deployment security review. Unknown provider outcomes and cap/concurrency cases are covered by controlled regressions; no participant spent the full two-million-token budget. **UNVERIFIED_CALIBRATION** remains explicit.

## Historical human-review verification — 21 November 2026

The earlier exercise below verified the original human-review mode at port 3000. It is preserved as historical evidence and does not establish the later automatic/revision behavior.
Completed 21 November 2026. The corrected ten-participant exercise and its read-only accounting/evidence audit passed. The application remains a local calibration deployment; this report does not certify perfect AI judgment or production qualification.

## Tested environment and evidence

- Application: http://localhost:3000; API: http://localhost:4000/api/v1.
- Actual Chrome sessions authenticated through Keycloak: one organizer and participant1 through participant10. Each enrolled participant had a separate 2,000,000-token generation wallet.
- Corrected competition: **SYSTEM TEST · Ten participant exercise · 2026-11-21T07-36-27-205Z**; ID **f8e4dcd0-8ed3-42de-be12-bf61831af96a**.
- Final state: **CALIBRATION_REVEALED**. Ten immutable final selections; eleven generation versions. Participant10 generated twice and selected version1; both versions counted.
- Generator: DeepSeek `deepseek/deepseek-v4.1-flash-1017`, fixed Fireworks provider through OpenRouter.
- Independent integrity reviewer and separate solution-quality calls: `anthropic/claude-sonnet-5.5`, Anthropic provider through OpenRouter.
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

- Generation input: **1956** tokens.
- Generation output: **656** tokens.
- Participant generation total: **2612** tokens.
- All ten final wallet reservations: **0**. No unresolved generation calls.
- Organizer quality/reviewer usage: **89065** tokens. It did not affect participant balances or efficiency.
- Cached-input and reasoning-output subsets were already included in their receipt totals and were not added again.
- Provider-reported cost for this corrected round: **USD 0.26765683**, about $0.27. This is receipt evidence, not a replacement for the provider's final billing statement.

For every participant, stored generation receipts equaled the confirmed wallet and cumulative ledger deltas. The final token snapshot included every generation version, including the unselected second answer. Reservations were not refunded by bans. A real PostgreSQL concurrency regression also proved that the tenth seat is allocated once and an eleventh valid invite receives no wallet.

| Participant | Scenario | Generated versions / selected | Generation tokens | AI recommendation | Human deduction | Stored score | Award state |
|---|---|---:|---:|---|---:|---:|---|
| participant1 | ORIGINAL | 1 / 1 | 203 | NO_VIOLATION | 0 | 96.0000 | Eligible |
| participant2 | FULL_COPY | 1 / 1 | 247 | POSSIBLE_VIOLATION | 1 | 95.0000 | Banned; rank withheld |
| participant3 | WHITESPACE_COPY | 1 / 1 | 312 | POSSIBLE_VIOLATION | 1 | 95.0000 | Eligible |
| participant4 | PARTIAL_COPY | 1 / 1 | 228 | POSSIBLE_VIOLATION | 1 | 95.0000 | Eligible |
| participant5 | REQUIRED_FACTS | 1 / 1 | 208 | NO_VIOLATION | 0 | 96.0000 | Eligible |
| participant6 | COMMON_TERMS | 1 / 1 | 196 | NO_VIOLATION | 0 | 96.0000 | Eligible |
| participant7 | ORIGINAL_AROUND_COPY | 1 / 1 | 273 | POSSIBLE_VIOLATION | 1 | 97.0000 | Eligible |
| participant8 | WRONG_ANSWER | 1 / 1 | 198 | NO_VIOLATION | 0 | 39.1083 | Ineligible |
| participant9 | SCHEMA_MISMATCH | 1 / 1 | 350 | NO_VIOLATION | 0 | 89.0000 | Eligible |
| participant10 | VERSION_HISTORY | 2 / 1 | 397 | NO_VIOLATION | 0 | 96.0000 | Eligible |

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

The first round recorded 2476 generation tokens, 144518 organizer tokens, 57 provider calls and USD 0.45820023 in reported cost. Across both full model exercises, reported cost totaled **USD 0.72585706**, about **$0.73**. The isolated admin drafts made no AI calls. Earlier unrelated verification calls are outside this scoped total.

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

Routine checks use `npm test`, the two isolated web test commands documented below, and `npm run build`.

```powershell
node --test apps/web/tests/generation.test.mjs
node --test apps/web/tests/problem-editor.test.mjs
```

`node scripts/system-e2e.mjs --live-ai` creates a new synthetic competition and makes paid model calls. It must not be used as a blind retry of an interrupted generation. `node scripts/run-system-audit.mjs --run .local/system-tests/<run-directory>` reconciles an existing designated test round using a read-only transaction and does not call any model. Keep the injected database connection private.
