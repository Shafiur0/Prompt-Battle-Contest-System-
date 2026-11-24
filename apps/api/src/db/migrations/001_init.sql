-- 001_init.sql
-- Core schema for the prompt battle platform.
-- Authorities: PostgreSQL for state, provider receipts for usage, humans for guilt.

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------
create table users (
  id              uuid primary key default gen_random_uuid(),
  idp_subject     text not null unique,
  display_alias   text not null,
  email           text,
  account_status  text not null default 'ACTIVE'
                    check (account_status in ('ACTIVE', 'SUSPENDED')),
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Rules manifests
-- ---------------------------------------------------------------------------
create table competition_rules_versions (
  id                        uuid primary key default gen_random_uuid(),
  version_label             text not null unique,
  model_provider            text not null,
  model_id                  text not null,
  model_revision            text not null,
  generation_settings       jsonb not null,
  envelope_template         text not null,
  envelope_digest           text not null,
  token_allowance           bigint not null check (token_allowance > 0),
  efficiency_reference_tokens bigint not null check (efficiency_reference_tokens > 0),
  max_output_tokens         integer not null check (max_output_tokens > 0),
  input_upper_bound         bigint not null check (input_upper_bound > 0),
  provider_qualified        boolean not null default false,
  feedback_policy           jsonb not null,
  scoring_formula_version   text not null,
  penalty_schedule          jsonb not null,
  judge_config              jsonb not null,
  registry_version_id       uuid,
  integrity_policy_version_id uuid,
  reviewer_model_version_id uuid,
  matcher_version           text,
  manifest_digest           text not null,
  created_at                timestamptz not null default now()
);

create table competitions (
  id                   uuid primary key default gen_random_uuid(),
  slug                 text not null unique,
  title                text not null,
  capacity             integer not null default 10 check (capacity between 1 and 1000),
  lifecycle            text not null default 'DRAFT'
                         check (lifecycle in ('DRAFT','ENROLLMENT_OPEN','ROSTER_FROZEN','GENERATION_OPEN',
                                              'GENERATION_CLOSED','SELECTION_CLOSED','RESULTS_REVEALED','CLOSED')),
  rules_version_id     uuid not null references competition_rules_versions(id),
  enrollment_opens_at  timestamptz,
  generation_cutoff_at timestamptz,
  selection_cutoff_at  timestamptz,
  reveal_at            timestamptz,
  closure_epoch        uuid,
  closure_recorded_at  timestamptz,
  created_at           timestamptz not null default now()
);

create table competition_roles (
  id             uuid primary key default gen_random_uuid(),
  competition_id uuid not null references competitions(id),
  user_id        uuid not null references users(id),
  role           text not null check (role in ('PARTICIPANT','ORGANIZER','REVIEWER','APPEAL_REVIEWER')),
  granted_at     timestamptz not null default now(),
  unique (competition_id, user_id, role)
);

create table participants (
  id                        uuid primary key default gen_random_uuid(),
  competition_id            uuid not null references competitions(id),
  user_id                   uuid not null references users(id),
  enrollment_status         text not null default 'ENROLLED'
                              check (enrollment_status in ('ENROLLED','WITHDRAWN')),
  rules_accepted_version_id uuid not null references competition_rules_versions(id),
  enrolled_at               timestamptz not null default now(),
  unique (competition_id, user_id),
  unique (competition_id, id)
);

-- ---------------------------------------------------------------------------
-- Problems
-- ---------------------------------------------------------------------------
create table problems (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  problem_type text not null check (problem_type in ('STRUCTURED_ANSWER','EXECUTABLE','PROSE')),
  owner_id     uuid references users(id),
  created_at   timestamptz not null default now()
);

create table problem_versions (
  id               uuid primary key default gen_random_uuid(),
  problem_id       uuid not null references problems(id),
  version_sequence integer not null,
  title            text not null,
  statement        text not null,
  objectives       jsonb not null,
  public_constraints jsonb not null,
  output_contract  jsonb not null,
  public_examples  jsonb not null default '[]',
  problem_payload  jsonb not null,
  created_at       timestamptz not null default now(),
  unique (problem_id, version_sequence)
);

create table private_evaluation_definitions (
  id                uuid primary key default gen_random_uuid(),
  problem_version_id uuid not null unique references problem_versions(id),
  rubric            jsonb not null,
  critical_criteria jsonb not null,
  test_suite        jsonb not null,
  runner_digest     text,
  created_at        timestamptz not null default now()
);

create table public_test_cases (
  id                uuid primary key default gen_random_uuid(),
  problem_version_id uuid not null references problem_versions(id),
  test_key          text not null,
  weight            numeric(6,4) not null check (weight > 0),
  group_code        text not null check (group_code in ('C','K')),
  definition        jsonb not null,
  unique (problem_version_id, test_key)
);

create table private_test_cases (
  id                uuid primary key default gen_random_uuid(),
  problem_version_id uuid not null references problem_versions(id),
  test_key          text not null,
  weight            numeric(6,4) not null check (weight > 0),
  group_code        text not null check (group_code in ('C','K')),
  indispensable     boolean not null default false,
  definition        jsonb not null,
  unique (problem_version_id, test_key)
);

create table competition_problems (
  id                 uuid primary key default gen_random_uuid(),
  competition_id     uuid not null references competitions(id),
  problem_version_id uuid not null references problem_versions(id),
  ordinal            integer not null default 1,
  unique (competition_id, problem_version_id),
  unique (competition_id, id)
);

-- Initial competition policy: exactly one problem per competition.
create unique index competition_problems_single on competition_problems (competition_id);

create table participant_problem_states (
  id                     uuid primary key default gen_random_uuid(),
  participant_id         uuid not null references participants(id),
  competition_problem_id uuid not null references competition_problems(id),
  state                  text not null default 'OPEN'
                           check (state in ('OPEN','FINALIZING','FINALIZED','NO_SUBMISSION')),
  updated_at             timestamptz not null default now(),
  unique (participant_id, competition_problem_id)
);

create table prompt_drafts (
  id                     uuid primary key default gen_random_uuid(),
  participant_id         uuid not null references participants(id),
  competition_problem_id uuid not null references competition_problems(id),
  body                   text not null default '',
  updated_at             timestamptz not null default now(),
  unique (participant_id, competition_problem_id)
);

-- ---------------------------------------------------------------------------
-- Attempts: an attempt IS the immutable prompt version
-- ---------------------------------------------------------------------------
create table attempts (
  id                     uuid primary key default gen_random_uuid(),
  competition_id         uuid not null,
  participant_id         uuid not null,
  competition_problem_id uuid not null,
  parent_attempt_id      uuid references attempts(id),
  version_number         integer not null check (version_number > 0),
  prompt                 text not null,
  prompt_hash            text not null,
  prompt_bytes           integer not null check (prompt_bytes > 0),
  rules_version_id       uuid not null references competition_rules_versions(id),
  admitted_at            timestamptz not null default now(),
  unique (participant_id, competition_problem_id, version_number),
  foreign key (competition_id, participant_id) references participants (competition_id, id),
  foreign key (competition_id, competition_problem_id) references competition_problems (competition_id, id)
);

create table attempt_states (
  attempt_id       uuid primary key references attempts(id),
  generation_state text not null default 'QUEUED'
                     check (generation_state in ('QUEUED','DISPATCH_INTENT','GENERATING','GENERATION_COMPLETE',
                                                 'REJECTED_UNBILLED','FAILED_BILLED','FAILED_USAGE_PENDING',
                                                 'CANCELLED_BEFORE_DISPATCH','INFRASTRUCTURE_REVIEW')),
  accounting_state text not null default 'RESERVED'
                     check (accounting_state in ('RESERVED','USAGE_PENDING','SETTLED','RELEASED')),
  practice_state   text not null default 'NOT_STARTED'
                     check (practice_state in ('NOT_STARTED','EVALUATING','COMPLETE','INFRASTRUCTURE_REVIEW')),
  updated_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Provider calls and immutable answers
-- ---------------------------------------------------------------------------
create table provider_calls (
  id               uuid primary key default gen_random_uuid(),
  purpose          text not null check (purpose in ('GENERATION','QUALITY_JUDGE','INTEGRITY_REVIEW')),
  payer            text not null check (payer in ('PARTICIPANT','ORGANIZER')),
  attempt_id       uuid references attempts(id),
  evaluation_run_id uuid,
  participant_id   uuid references participants(id),
  request_id       uuid not null unique default gen_random_uuid(),
  dispatch_key     text not null unique,
  request_digest   text not null,
  model_id         text not null,
  model_revision   text not null,
  state            text not null default 'PENDING'
                     check (state in ('PENDING','DISPATCH_INTENT','DISPATCHED','COMPLETED','FAILED_BILLED',
                                      'FAILED_USAGE_PENDING','REJECTED_UNBILLED','CANCELLED_BEFORE_DISPATCH',
                                      'INFRASTRUCTURE_REVIEW')),
  reserved_tokens  bigint not null default 0 check (reserved_tokens >= 0),
  dispatched_at    timestamptz,
  created_at       timestamptz not null default now(),
  constraint provider_calls_purpose_refs check (
    (purpose = 'GENERATION' and attempt_id is not null and payer = 'PARTICIPANT')
    or (purpose in ('QUALITY_JUDGE','INTEGRITY_REVIEW') and attempt_id is null and payer = 'ORGANIZER')
  )
);

create table ai_responses (
  id                uuid primary key default gen_random_uuid(),
  provider_call_id  uuid not null unique references provider_calls(id),
  attempt_id        uuid not null references attempts(id),
  body              text not null,
  body_hash         text not null,
  finish_reason     text,
  output_format     text not null default 'text',
  created_at        timestamptz not null default now()
);

create table attempt_answer_bindings (
  attempt_id  uuid primary key references attempts(id),
  response_id uuid not null unique references ai_responses(id),
  bound_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Token accounting
-- ---------------------------------------------------------------------------
create table participant_token_accounts (
  id              uuid primary key default gen_random_uuid(),
  participant_id  uuid not null unique references participants(id),
  competition_id  uuid not null references competitions(id),
  allowance       bigint not null check (allowance > 0),
  consumed_tokens bigint not null default 0 check (consumed_tokens >= 0),
  reserved_tokens bigint not null default 0 check (reserved_tokens >= 0),
  account_state   text not null default 'OPEN'
                    check (account_state in ('OPEN','FINALIZING','CLOSED','ACCOUNTING_INCIDENT')),
  revision        bigint not null default 1,
  updated_at      timestamptz not null default now(),
  -- The strict cap. ACCOUNTING_INCIDENT is the only state allowed to record
  -- a provider's true excess; it never extends the allowance.
  constraint token_account_within_allowance check (
    account_state = 'ACCOUNTING_INCIDENT'
    or consumed_tokens + reserved_tokens <= allowance
  )
);

create table token_reservations (
  id                  uuid primary key default gen_random_uuid(),
  provider_call_id    uuid not null unique references provider_calls(id),
  account_id          uuid not null references participant_token_accounts(id),
  reserved_upper_bound bigint not null check (reserved_upper_bound > 0),
  state               text not null default 'HELD' check (state in ('HELD','SETTLED','RELEASED')),
  created_at          timestamptz not null default now()
);

create table provider_usage_receipts (
  id                  uuid primary key default gen_random_uuid(),
  provider_call_id    uuid not null references provider_calls(id),
  provider_request_id text,
  raw_usage           jsonb not null,
  input_tokens        bigint not null check (input_tokens >= 0),
  output_tokens       bigint not null check (output_tokens >= 0),
  total_tokens        bigint not null check (total_tokens >= 0),
  cached_input_tokens bigint not null default 0 check (cached_input_tokens >= 0),
  reasoning_tokens    bigint not null default 0 check (reasoning_tokens >= 0),
  receipt_hash        text not null,
  recovery_evidence   jsonb,
  created_at          timestamptz not null default now(),
  constraint receipt_total_matches check (total_tokens = input_tokens + output_tokens)
);

create unique index provider_usage_receipts_once on provider_usage_receipts (provider_call_id);

create table token_ledger_events (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references participant_token_accounts(id),
  sequence         bigint not null,
  event_type       text not null check (event_type in ('RESERVE','SETTLE','RELEASE','CORRECTION')),
  consumed_delta   bigint not null default 0,
  reserved_delta   bigint not null default 0,
  provider_call_id uuid references provider_calls(id),
  receipt_id       uuid references provider_usage_receipts(id),
  reason           text,
  created_at       timestamptz not null default now(),
  unique (account_id, sequence)
);

-- A physical call may settle at most once.
create unique index token_ledger_settles_once
  on token_ledger_events (provider_call_id) where event_type = 'SETTLE';

create table pricing_versions (
  id                       uuid primary key default gen_random_uuid(),
  provider                 text not null,
  model_id                 text not null,
  currency                 text not null default 'USD',
  input_per_million        numeric(18,6) not null check (input_per_million >= 0),
  cached_input_per_million numeric(18,6) not null check (cached_input_per_million >= 0),
  output_per_million       numeric(18,6) not null check (output_per_million >= 0),
  effective_from           timestamptz not null default now(),
  unique (provider, model_id, effective_from)
);

-- ---------------------------------------------------------------------------
-- Evaluation
-- ---------------------------------------------------------------------------
create table evaluation_runs (
  id                      uuid primary key default gen_random_uuid(),
  purpose                 text not null
                            check (purpose in ('PUBLIC_PRACTICE','FINAL_SOLUTION','CRITICAL_MATCH','CRITICAL_CONTEXT_REVIEW')),
  competition_id          uuid not null references competitions(id),
  attempt_id              uuid references attempts(id),
  final_selection_id      uuid,
  parent_run_id           uuid references evaluation_runs(id),
  closure_epoch           uuid,
  registry_version_id     uuid,
  policy_version_id       uuid,
  reviewer_model_version_id uuid,
  input_digest            text not null,
  authorized_revision     integer not null default 1 check (authorized_revision > 0),
  state                   text not null default 'PENDING'
                            check (state in ('PENDING','RUNNING','COMPLETE','INFRASTRUCTURE_REVIEW')),
  created_at              timestamptz not null default now()
);

create unique index evaluation_runs_practice_once
  on evaluation_runs (attempt_id) where purpose = 'PUBLIC_PRACTICE';
create unique index evaluation_runs_final_once
  on evaluation_runs (final_selection_id) where purpose = 'FINAL_SOLUTION';
create unique index evaluation_runs_match_once
  on evaluation_runs (final_selection_id, registry_version_id, authorized_revision)
  where purpose = 'CRITICAL_MATCH';
create unique index evaluation_runs_context_once
  on evaluation_runs (final_selection_id, registry_version_id, reviewer_model_version_id,
                      closure_epoch, authorized_revision)
  where purpose = 'CRITICAL_CONTEXT_REVIEW';

create table test_results (
  id                uuid primary key default gen_random_uuid(),
  evaluation_run_id uuid not null references evaluation_runs(id),
  test_key          text not null,
  visibility        text not null check (visibility in ('public','private')),
  status            text not null check (status in ('PASS','FAIL','RUNNER_ERROR')),
  weight            numeric(6,4) not null check (weight > 0),
  group_code        text not null check (group_code in ('C','K')),
  evidence          jsonb,
  created_at        timestamptz not null default now(),
  unique (evaluation_run_id, test_key)
);

create table judge_results (
  id                uuid primary key default gen_random_uuid(),
  evaluation_run_id uuid not null references evaluation_runs(id),
  pass_number       integer not null check (pass_number > 0),
  judge_config      jsonb not null,
  scores            jsonb not null,
  j_value           numeric(6,4) check (j_value >= 0 and j_value <= 1),
  validity          text not null check (validity in ('VALID','UNCERTAIN','INVALID')),
  raw_receipt       jsonb,
  created_at        timestamptz not null default now(),
  unique (evaluation_run_id, pass_number)
);

-- ---------------------------------------------------------------------------
-- Critical Information Registry
-- ---------------------------------------------------------------------------
create table critical_information_registry (
  id                 uuid primary key default gen_random_uuid(),
  competition_id     uuid not null unique references competitions(id),
  organizer_id       uuid not null references users(id),
  current_version_id uuid,
  created_at         timestamptz not null default now()
);

create table critical_information_policy_versions (
  id                      uuid primary key default gen_random_uuid(),
  competition_id          uuid not null references competitions(id),
  policy_sequence         integer not null check (policy_sequence > 0),
  public_restrictions     jsonb not null,
  exceptions              jsonb not null,
  penalty_schedule_key    text not null,
  penalty_schedule_digest text not null,
  created_at              timestamptz not null default now(),
  unique (competition_id, policy_sequence)
);

create table critical_information_registry_versions (
  id                  uuid primary key default gen_random_uuid(),
  registry_id         uuid not null references critical_information_registry(id),
  competition_id      uuid not null references competitions(id),
  problem_version_id  uuid not null references problem_versions(id),
  policy_version_id   uuid not null references critical_information_policy_versions(id),
  version_sequence    integer not null check (version_sequence > 0),
  predecessor_id      uuid references critical_information_registry_versions(id),
  state               text not null default 'DRAFT'
                        check (state in ('DRAFT','VALIDATED','PUBLISHED','RETIRED')),
  partial_min_code_points integer not null default 32
                        check (partial_min_code_points between 16 and 128),
  source_text         text not null,
  source_hash         text not null,
  content_digest      text not null,
  public_policy_digest text not null,
  created_at          timestamptz not null default now(),
  unique (registry_id, version_sequence),
  unique (competition_id, id)
);

create table critical_information_items (
  item_version_id         uuid primary key default gen_random_uuid(),
  stable_item_id          uuid not null,
  registry_version_id     uuid not null references critical_information_registry_versions(id),
  competition_id          uuid not null,
  problem_version_id      uuid not null,
  source_start_byte       integer not null check (source_start_byte >= 0),
  source_end_byte         integer not null check (source_end_byte > source_start_byte),
  quote                   text not null,
  category                text not null
                            check (category in ('PROTECTED_CRITICAL_INFORMATION','ALLOWED_PUBLIC_INFORMATION',
                                                'REQUIRED_INFORMATION','PRIVATE_EVALUATION_CRITERIA')),
  protection_status       text not null check (protection_status in ('PROTECTED','PERMITTED','PRIVATE_REFERENCE')),
  public_rule_id          text,
  public_explanation      text,
  private_review_explanation text,
  allowed_reuse_rules     jsonb not null default '[]',
  prohibited_reuse_rules  jsonb not null default '[]',
  exception_rule_ids      jsonb not null default '[]',
  severity_level          text not null default 'NONE' check (severity_level in ('NONE','MINOR','MATERIAL')),
  policy_version_id       uuid not null,
  organizer_id            uuid not null,
  created_at              timestamptz not null default now(),
  unique (registry_version_id, stable_item_id),
  -- Protection requires a published public rule.
  constraint protected_needs_public_rule check (
    protection_status <> 'PROTECTED' or public_rule_id is not null
  ),
  -- A private evaluation reference can never be a protected copying source.
  constraint private_reference_never_protected check (
    not (category = 'PRIVATE_EVALUATION_CRITERIA' and protection_status = 'PROTECTED')
  )
);

create table reviewer_model_versions (
  id                 uuid primary key default gen_random_uuid(),
  release_label      text not null unique,
  provider           text not null,
  base_model         text not null,
  revision_contract  text not null,
  settings           jsonb not null,
  template_version   text not null,
  schema_version     text not null,
  matcher_version    text not null,
  preparation_method text not null,
  provenance         jsonb not null default '{}',
  benchmark_digest   text,
  qualification_state text not null default 'DRAFT'
                       check (qualification_state in ('DRAFT','PREPARED','QUALIFICATION_PENDING',
                                                      'QUALIFIED','DEPLOYED','RETIRED')),
  qualified_at       timestamptz,
  content_digest     text not null,
  created_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Final selection and sealing
-- ---------------------------------------------------------------------------
create table final_selections (
  id                     uuid primary key default gen_random_uuid(),
  competition_id         uuid not null,
  participant_id         uuid not null,
  competition_problem_id uuid not null,
  attempt_id             uuid not null references attempts(id),
  accepted_at            timestamptz not null default now(),
  unique (participant_id, competition_problem_id),
  unique (competition_id, id),
  foreign key (competition_id, participant_id) references participants (competition_id, id)
);

create table submission_states (
  id                uuid primary key default gen_random_uuid(),
  final_selection_id uuid not null unique references final_selections(id),
  state             text not null default 'SELECTION_COMMITTED'
                      check (state in ('SELECTION_COMMITTED','SEALING','FINAL_EVALUATING',
                                       'FINALIZATION_PENDING','SEALED_RESULT','PUBLISHED')),
  updated_at        timestamptz not null default now()
);

create table submission_token_snapshots (
  id                       uuid primary key default gen_random_uuid(),
  final_selection_id       uuid not null references final_selections(id),
  predecessor_snapshot_id  uuid references submission_token_snapshots(id),
  ledger_boundary          bigint not null check (ledger_boundary >= 0),
  cumulative_consumed_tokens bigint not null check (cumulative_consumed_tokens >= 0),
  kind                     text not null default 'INITIAL' check (kind in ('INITIAL','CORRECTION')),
  created_at               timestamptz not null default now()
);

create unique index submission_snapshot_initial_once
  on submission_token_snapshots (final_selection_id) where kind = 'INITIAL';

create table final_submissions (
  id                uuid primary key default gen_random_uuid(),
  final_selection_id uuid not null unique references final_selections(id),
  attempt_id        uuid not null references attempts(id),
  response_id       uuid not null references ai_responses(id),
  rules_version_id  uuid not null references competition_rules_versions(id),
  token_snapshot_id uuid not null references submission_token_snapshots(id),
  sealed_at         timestamptz not null default now()
);

create table policy_reviews (
  id                 uuid primary key default gen_random_uuid(),
  competition_id     uuid not null references competitions(id),
  final_selection_id uuid,
  purpose            text not null default 'INTEGRITY'
                       check (purpose in ('INTEGRITY','APPEAL')),
  adjudication_mode  text not null check (adjudication_mode in ('MACHINE_ASSISTED','HUMAN_ONLY')),
  verdict            text not null
                       check (verdict in ('NO_VIOLATION','CONFIRMED_VIOLATION','INSUFFICIENT_EVIDENCE')),
  rule_id            text,
  severity           text check (severity in ('NONE','MINOR','MATERIAL')),
  approved_points    integer not null default 0 check (approved_points in (0,1,3)),
  reason_code        text,
  rationale          text not null,
  report_id          uuid,
  failure_provenance jsonb,
  actor_user_id      uuid not null references users(id),
  predecessor_id     uuid references policy_reviews(id),
  created_at         timestamptz not null default now(),
  -- A confirmed violation needs a specific published rule and approved points.
  constraint confirmed_needs_rule_and_points check (
    verdict <> 'CONFIRMED_VIOLATION'
    or (rule_id is not null and approved_points > 0 and severity in ('MINOR','MATERIAL'))
  ),
  -- Cleared and inconclusive outcomes carry no points.
  constraint cleared_has_no_points check (
    verdict = 'CONFIRMED_VIOLATION' or approved_points = 0
  )
);

create table prompt_copy_matches (
  id                uuid primary key default gen_random_uuid(),
  match_run_id      uuid not null references evaluation_runs(id),
  item_version_id   uuid not null references critical_information_items(item_version_id),
  method            text not null,
  prompt_start_byte integer not null check (prompt_start_byte >= 0),
  prompt_end_byte   integer not null check (prompt_end_byte > prompt_start_byte),
  prompt_quote      text not null,
  source_start_byte integer not null check (source_start_byte >= 0),
  source_end_byte   integer not null check (source_end_byte > source_start_byte),
  source_quote      text not null,
  prompt_hash       text not null,
  source_hash       text not null,
  source_coverage   numeric(9,8) not null check (source_coverage >= 0 and source_coverage <= 1),
  exempt            boolean not null default false,
  evidence_digest   text not null,
  created_at        timestamptz not null default now()
);

create table prompt_integrity_reviews (
  id                       uuid primary key default gen_random_uuid(),
  context_run_id           uuid not null unique references evaluation_runs(id),
  match_run_id             uuid not null references evaluation_runs(id),
  competition_id           uuid not null,
  final_selection_id       uuid not null references final_selections(id),
  reviewed_attempt_id      uuid not null references attempts(id),
  registry_version_id      uuid not null,
  policy_version_id        uuid not null,
  reviewer_model_version_id uuid not null,
  report                   jsonb not null,
  report_digest            text not null,
  copy_ratio               numeric(9,8) not null check (copy_ratio >= 0 and copy_ratio <= 1),
  verdict                  text not null
                             check (verdict in ('NO_VIOLATION','POSSIBLE_VIOLATION','INSUFFICIENT_EVIDENCE')),
  human_review_required    boolean not null default true,
  created_at               timestamptz not null default now()
);

create table prompt_integrity_appeals (
  id                       uuid primary key default gen_random_uuid(),
  competition_id           uuid not null,
  final_selection_id       uuid not null references final_selections(id),
  challenged_decision_id   uuid not null references policy_reviews(id),
  participant_id           uuid not null,
  reason                   text not null,
  accepted_at              timestamptz not null default now(),
  resolved_by_decision_id  uuid references policy_reviews(id)
);

-- ---------------------------------------------------------------------------
-- Scores and leaderboard
-- ---------------------------------------------------------------------------
create table score_revisions (
  id                  uuid primary key default gen_random_uuid(),
  competition_id      uuid not null,
  final_submission_id uuid not null references final_submissions(id),
  evaluation_run_id   uuid references evaluation_runs(id),
  token_snapshot_id   uuid not null references submission_token_snapshots(id),
  policy_review_id    uuid references policy_reviews(id),
  c_value             numeric(9,8) not null check (c_value >= 0 and c_value <= 1),
  k_value             numeric(9,8) not null check (k_value >= 0 and k_value <= 1),
  j_value             numeric(9,8) not null check (j_value >= 0 and j_value <= 1),
  t_tokens            bigint not null check (t_tokens >= 0),
  q_value             numeric(9,8) not null,
  e_value             numeric(9,8) not null,
  g_value             numeric(9,8) not null,
  base_score          numeric(14,8) not null,
  penalty_points      integer not null default 0 check (penalty_points in (0,1,3)),
  final_score         numeric(14,8) not null,
  eligible            boolean not null,
  formula_version     text not null,
  input_digest        text not null,
  revision            integer not null default 1 check (revision > 0),
  published           boolean not null default false,
  created_at          timestamptz not null default now(),
  unique (final_submission_id, revision)
);

create unique index score_revisions_one_published
  on score_revisions (final_submission_id) where published;

create table leaderboard_projection (
  id                uuid primary key default gen_random_uuid(),
  competition_id    uuid not null references competitions(id),
  score_revision_id uuid not null unique references score_revisions(id),
  alias             text not null,
  final_score       numeric(14,8) not null,
  quality           numeric(9,8) not null,
  cumulative_tokens bigint not null,
  eligible          boolean not null,
  rank              integer not null,
  computed_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Audit, delivery, idempotency
-- ---------------------------------------------------------------------------
create table audit_events (
  id            bigserial primary key,
  actor_user_id uuid,
  actor_kind    text not null default 'USER',
  competition_id uuid,
  entity_type   text not null,
  entity_id     text not null,
  action        text not null,
  payload       jsonb not null default '{}',
  request_id    text,
  prev_hash     text,
  hash          text not null,
  created_at    timestamptz not null default now()
);

create table outbox_events (
  id           uuid primary key default gen_random_uuid(),
  topic        text not null,
  payload      jsonb not null,
  state        text not null default 'PENDING'
                 check (state in ('PENDING','DISPATCHED','DONE','FAILED')),
  attempts     integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  last_error   text,
  created_at   timestamptz not null default now()
);

create table idempotency_keys (
  id              uuid primary key default gen_random_uuid(),
  participant_id  uuid not null,
  competition_id  uuid not null,
  operation       text not null,
  key             text not null,
  payload_digest  text not null,
  response        jsonb,
  created_at      timestamptz not null default now(),
  unique (participant_id, competition_id, operation, key)
);

-- ---------------------------------------------------------------------------
-- Deferred foreign keys (circular references)
-- ---------------------------------------------------------------------------
alter table provider_calls
  add constraint provider_calls_evaluation_run_fk
  foreign key (evaluation_run_id) references evaluation_runs(id);

alter table evaluation_runs
  add constraint evaluation_runs_final_selection_fk
  foreign key (final_selection_id) references final_selections(id);

alter table evaluation_runs
  add constraint evaluation_runs_registry_version_fk
  foreign key (registry_version_id) references critical_information_registry_versions(id);

alter table evaluation_runs
  add constraint evaluation_runs_reviewer_version_fk
  foreign key (reviewer_model_version_id) references reviewer_model_versions(id);

alter table policy_reviews
  add constraint policy_reviews_final_selection_fk
  foreign key (final_selection_id) references final_selections(id);

alter table policy_reviews
  add constraint policy_reviews_report_fk
  foreign key (report_id) references prompt_integrity_reviews(id);

alter table competition_rules_versions
  add constraint rules_registry_version_fk
  foreign key (registry_version_id) references critical_information_registry_versions(id);

alter table competition_rules_versions
  add constraint rules_policy_version_fk
  foreign key (integrity_policy_version_id) references critical_information_policy_versions(id);

alter table competition_rules_versions
  add constraint rules_reviewer_version_fk
  foreign key (reviewer_model_version_id) references reviewer_model_versions(id);

alter table critical_information_registry
  add constraint registry_current_version_fk
  foreign key (current_version_id) references critical_information_registry_versions(id);

-- ---------------------------------------------------------------------------
-- Immutability: content tables reject UPDATE and DELETE outright
-- ---------------------------------------------------------------------------
create or replace function deny_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'IMMUTABLE_TABLE: % rejects %', TG_TABLE_NAME, TG_OP
    using errcode = 'restrict_violation';
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'attempts','ai_responses','attempt_answer_bindings','provider_usage_receipts',
    'token_ledger_events','token_reservations','test_results','judge_results',
    'policy_reviews','final_selections','submission_token_snapshots','final_submissions',
    'score_revisions','critical_information_registry_versions','critical_information_items',
    'prompt_copy_matches','prompt_integrity_reviews','prompt_integrity_appeals',
    'audit_events','critical_information_policy_versions','reviewer_model_versions',
    'problem_versions','private_evaluation_definitions','public_test_cases','private_test_cases',
    'competition_rules_versions'
  ] loop
    execute format(
      'create trigger %I_immutable before update or delete on %I
       for each row execute function deny_mutation()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Cross-row ownership guards that a CHECK constraint cannot express
-- ---------------------------------------------------------------------------
create or replace function enforce_answer_binding_owner() returns trigger
language plpgsql as $$
declare ok boolean;
begin
  select (r.attempt_id = new.attempt_id) into ok from ai_responses r where r.id = new.response_id;
  if ok is not true then
    raise exception 'ANSWER_BINDING_MISMATCH: response does not belong to attempt %', new.attempt_id
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end $$;

create trigger attempt_answer_bindings_owner
  before insert on attempt_answer_bindings
  for each row execute function enforce_answer_binding_owner();

create or replace function enforce_selection_owner() returns trigger
language plpgsql as $$
declare a record;
begin
  select participant_id, competition_problem_id, competition_id into a
    from attempts where id = new.attempt_id;
  if a is null
     or a.participant_id <> new.participant_id
     or a.competition_problem_id <> new.competition_problem_id
     or a.competition_id <> new.competition_id then
    raise exception 'SELECTION_ATTEMPT_MISMATCH: attempt % is not owned by this participant and problem', new.attempt_id
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end $$;

create trigger final_selections_owner
  before insert on final_selections
  for each row execute function enforce_selection_owner();

create or replace function enforce_attempt_participant() returns trigger
language plpgsql as $$
declare p uuid;
begin
  select competition_id into p from participants where id = new.participant_id;
  if p is distinct from new.competition_id then
    raise exception 'ATTEMPT_COMPETITION_MISMATCH';
  end if;
  return new;
end $$;

create trigger attempts_competition_guard
  before insert on attempts
  for each row execute function enforce_attempt_participant();

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index attempts_owner on attempts (participant_id, competition_problem_id, version_number desc);
create index attempts_competition on attempts (competition_id, admitted_at);
create index provider_calls_attempt on provider_calls (attempt_id);
create index provider_calls_recovery on provider_calls (state) where state in ('DISPATCH_INTENT','DISPATCHED','FAILED_USAGE_PENDING');
create index token_ledger_account on token_ledger_events (account_id, sequence);
create index outbox_pending on outbox_events (available_at) where state = 'PENDING';
create index evaluation_runs_selection on evaluation_runs (final_selection_id, purpose);
create index policy_reviews_case on policy_reviews (competition_id, final_selection_id, created_at);
create index prompt_copy_matches_run on prompt_copy_matches (match_run_id, item_version_id);
create index leaderboard_competition on leaderboard_projection (competition_id, rank);
create index appeals_open on prompt_integrity_appeals (challenged_decision_id) where resolved_by_decision_id is null;
create index registry_items_version on critical_information_items (registry_version_id, stable_item_id);
