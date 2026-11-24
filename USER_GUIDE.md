# Prompt Battle user guide

Open [localhost:3100](http://localhost:3100) and sign in. The organizer opens directly on one competition page. Use the header competition selector to choose another round; **New competition** creates a draft.

## Organizer: one page

- **Problem:** use Add/Edit, View statement or Delete. Deletion is available only for drafts. Edit opens one form with the title, statement and correct number/text answer. Explanation is optional. **Save problem** returns to the problem card; **Cancel** protects unsaved changes. Goals and advanced rules stay collapsed.
- **Participants:** every enrolled participant appears with progress, tokens, overall rank and solving position. Click a name for details. Ban/Unban are direct manual actions requiring your recorded reason and, for a ban, verified conduct. They preserve usage and history.
- **Announcements:** enter a message and choose **Publish**. The latest three notices appear nearby; open **History** for earlier notices and withdrawal controls.
- **Settings:** the single settings button opens **Competition settings**. Expand Schedule, Copying rules or AI connection as needed. Schedule times use Dhaka time.

Publish when the problem, connection, copying rules and schedule are ready. After final selections, close the competition, wait for automatic evaluation and settled usage, then release finalized results. Pending stages cannot be published as invented scores or deductions.

## Problem answers and revisions

The simple form checks one exact number or text answer. Text matching includes capitalization, spaces and punctuation. The expected answer stays private. If you leave Explanation blank, the system stores generic reference-format metadata; it does not guess an answer or call AI.

Existing custom problems retain their saved schemas, requirements, checks and references under **Advanced settings**. Replacing them with a simple answer requires confirmation. Saving any edit appends a revision: earlier attempts keep their original task and tests. Editing does not reopen a closed round, reset tokens or change a final selection.

## Rank and solving order

**Overall rank** follows the final score. **Solved first** records the order of fully correct answers. Equal scores use the earliest correct completion under the recorded tie rule. Changing the leaderboard view changes display order only.

Completion durations, such as **3m 20s**, are measured from the frozen competition start. Missing historical timing shows **Not recorded**. Organizers can inspect their private results after closure; participants receive positions after publication. The participant workspace and public Leaderboard show the same personal positions.

## Participant: compete

1. Choose a competition, join and accept its rules.
2. Read the public task and answer instructions.
3. Write your prompt manually, generate an answer and inspect public test feedback.
4. Choose one completed answer and lock the final selection.

All generations count toward the 2,000,000-token allowance, including unselected versions. Answers cannot be edited. A closed browser or unknown provider outcome does not refund a dispatched request; uncertain usage stays reserved until reconciled.

Copying review runs automatically after whole-competition closure. Required facts, numbers, constraints and output keys remain reusable. Supported protected-copy decisions apply the published 0/1/3-point schedule once. No copying warnings or hints appear during competition. Manual bans are separate organizer decisions.

After publication, **Request a review** submits your own dispute under the same frozen rules. It does not change the original prompt or answer. An unresolved appeal keeps the stale result hidden; older human-review rounds retain their recorded process.

## Local setup

From the project folder, run `npm install`, then `npm run local`. For previously built output after infrastructure/database setup, use `npm run start:local`.

Local accounts are `organizer` with `local-organizer-change-me`, and `participant1` through `participant10` with `local-participant-change-me`. These are local development fixtures.

Set the OpenRouter key privately in `.env` and restart the application after changing it. The AI connection area reports readiness; keys stay out of participant pages. This remains a local calibration deployment, with separate provider/reviewer qualification needed for official use.

See [README.md](README.md) for setup and [SYSTEM_TEST_REPORT.md](SYSTEM_TEST_REPORT.md) for dated evidence. Earlier layout checks remain historical snapshots.
### Recover an expired sign-in

Start a fresh sign-in at http://localhost:3100/api/v1/auth/login. A completed callback address cannot be reused. If the identity page remembers another account, choose **Restart login**, then enter your participant username. Participant accounts use participant1 through participant10 with local-participant-change-me. Use **Switch account** in the application header to begin another sign-in.
