# Prompt Battle — local platform

A competition platform with manually authored prompts, immutable AI answers, a 2,000,000-token generation allowance per participant, deterministic solution checks, automatic post-closure copying review, and separate manual organizer bans.

## Run locally

Requirements: Node.js 24 LTS or later, npm and a running Docker Desktop Linux engine.

1. Copy `.env.example` to `.env` if it does not already exist.
2. Set `OPENROUTER_API_KEY` privately in `.env`.
3. Run `npm install`, then `npm run local`.
4. Open [http://localhost:3100](http://localhost:3100).

Startup prepares PostgreSQL, Redis, Keycloak, private S3-compatible storage and the database/sample, then starts the API, worker and web application. Port 3100 allows an unrelated application on port 3000 to keep running. Use the configured address consistently for login and cookies. Missing model configuration produces a configuration-needed state; the system does not invent answers or token usage.

| Local role | Username | Local-only password |
|---|---|---|
| Organizer | `organizer` | `local-organizer-change-me` |
| Participants | `participant1` through `participant10` | `local-participant-change-me` |

## Use the organizer page

Open [localhost:3100](http://localhost:3100) and sign in as organizer. Everything opens on one page; the header competition selector changes rounds.

- Add/Edit the current problem in one form. Enter the title, statement and correct number/text answer, then **Save problem**. Explanation is optional; goals and advanced rules stay collapsed. Saving returns to the problem card.
- Click a participant name for details; ranks, solving order, token use and Ban/Unban actions appear in the same view.
- Write a message and choose **Publish**. Three recent notices appear nearby; **History** contains older notices and withdrawal controls.
- Use **Settings** to open **Competition settings** for Schedule, Copying rules and AI connection.

The Leaderboard opens to **All problems**, where total points combine eligible published final scores across problems. Equal totals share an overall rank. **This problem** keeps the selected round's final-score ranking and solving order separate. Samples and test rounds are excluded from overall totals unless selected. Search and filters remain available; unpublished results stay pending. Dated test evidence is in [SYSTEM_TEST_REPORT.md](SYSTEM_TEST_REPORT.md); earlier layout checks are retained as historical snapshots.
## Competition behavior

Create a draft and save its problem on the organizer page. Add/Edit, View and draft Delete actions stay on the current-problem card. Use the single **Settings** button to configure the schedule, copying rules and AI connection before publication.

Organizers can save new problem revisions after publication. Every attempt keeps its original problem, tests, registry and rules accepted at admission. Later revisions apply to new attempts. Editing does not reopen workspaces, reset usage or change final selections. Problem removal remains draft-only.

New rounds use automatic copying decisions after whole-competition closure. The independent reviewer examines the selected final prompt against its original public copying policy and retained evidence. The server applies the published deduction once: 0 for no violation, 1 for MINOR, or 3 for MATERIAL. Required facts, numbers, constraints, output keys and legitimate paraphrases remain reusable. Uncertainty or reviewer failure keeps the result pending. No live copying warnings or hints appear during competition.

The organizer can inspect decisions, reasons, rule references, deductions, total generation usage and correct-completion timing. Manual bans for separately confirmed misconduct require an organizer action and preserve token/answer history. Older published rounds retain their originally recorded human-review policy.

Eligible rankings compare exact final score, then earliest fully correct completion for equal scores, then quality, correctness and lower cumulative generation tokens. Completion must pass the original schema with C=1 and K=1; eligibility alone is insufficient. The server uses its receipt of the earliest correct answer for the selected problem revision, measured from the frozen competition start. Timing adds no points. All generations count toward token efficiency, including unselected answers.

## AI connection and accounting

One backend-only OpenRouter key accesses the fixed roles:

- Generator: `deepseek/deepseek-v4.1-flash-1017`.
- Separate quality judge and Critical Information Reviewer: `anthropic/claude-sonnet-5.5`, with independent instructions, schema and conversation.

Judge/reviewer usage is organizer-funded, outside participant generation allowances. No model training is claimed. Keep keys out of chat, browser code and source control.

The server reserves a request bound before dispatch and settles actual reported input/output usage afterward. Unknown network outcomes retain their reservations until reconciled; generation is not blindly retried.

## Commands and services

- `npm run local`: infrastructure/database preparation and development servers.
- `npm run dev`: API, worker and web development servers.
- `npm run build`: compile all packages and the production web app.
- `npm run start:local`: run built servers after infrastructure/database setup.
- `npm run test`, `npm run typecheck`: automated checks.
- `npm run db:migrate`, `npm run db:seed`: schema/sample preparation.
- `npm run infra:up`, `npm run infra:down`: start/stop services without deleting volumes.

Stop the foreground process group with Ctrl+C before restarting after a private `.env` key change.

| Service | Address |
|---|---|
| Application | http://localhost:3100 |
| API | http://localhost:4000/api/v1 |
| Login | http://localhost:8080/realms/prompt-battle |
| Private S3 endpoint | http://localhost:9000 |
| Storage console | http://localhost:9001 |

RustFS provides the local private S3-compatible container. Existing `MINIO_*` client names remain compatible.

## Verification and deployment boundary

See [SYSTEM_TEST_REPORT.md](SYSTEM_TEST_REPORT.md) for dated observed results, [USER_GUIDE.md](USER_GUIDE.md) for workflows, and [docs/PROBLEM_AUTHORING.md](docs/PROBLEM_AUTHORING.md) for a working problem.

This remains a local calibration deployment. Model availability, a valid key and passing tests do not qualify complete provider token bounds or independently benchmark the reviewer. Official use still requires authoritative accounting/recovery evidence, model benchmarks and production identity, secrets, HTTPS, retention, storage and backup controls. Local accounts and container credentials are development fixtures.

## Open a Cloudflare Tunnel

Prepare the local services once with `npm run local`, then press Ctrl+C to stop its foreground servers and run `npm run tunnel`. Keep Docker Desktop running. The tunnel command downloads Cloudflare's official Windows client into `.local/cloudflare`, builds the app, and prints a temporary public HTTPS link. Sign-in, participant workspaces and organizer pages use the same link and existing accounts.

The command starts the tunnel and app in the background. Keep this computer awake and Docker Desktop running. Logs and process records are in `.local/cloudflare`. Each new tunnel gets a new address.

Run `npm run tunnel:stop` to close public access and restore [http://localhost:3100](http://localhost:3100), including local sign-in. The private `.env` file stays configured for local use. If setup fails, run the stop command before retrying.

This shares the existing local calibration deployment, including its configured development accounts.
