BEGIN;
CREATE SCHEMA IF NOT EXISTS battle;
SET search_path TO battle;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), issuer text NOT NULL, subject text NOT NULL,
 alias text NOT NULL, is_organizer boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(issuer,subject)
);
CREATE TABLE IF NOT EXISTS auth_flows (
 token_hash text PRIMARY KEY, state text UNIQUE NOT NULL, nonce text NOT NULL, verifier text NOT NULL,
 expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS competitions (
 id uuid PRIMARY KEY, title text NOT NULL, status text NOT NULL DEFAULT 'DRAFT'
 CHECK(status IN ('DRAFT','GENERATION_OPEN','CLOSED','REVEALED','CALIBRATION_REVEALED')),
 capacity integer NOT NULL DEFAULT 10 CHECK(capacity BETWEEN 1 AND 10),
 problem jsonb NOT NULL, rules_version_id uuid, registry_version_id uuid,
 generation_cutoff timestamptz, selection_cutoff timestamptz, reveal_at timestamptz,
 calibration boolean NOT NULL DEFAULT true, closure_epoch uuid,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS organizer_id uuid REFERENCES users(id);
CREATE TABLE IF NOT EXISTS problem_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), competition_id uuid NOT NULL REFERENCES competitions(id),
 version_id text NOT NULL, sequence integer NOT NULL CHECK(sequence>0), content jsonb NOT NULL, digest text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(competition_id,version_id), UNIQUE(competition_id,sequence)
);
INSERT INTO problem_versions(competition_id,version_id,sequence,content,digest)
 SELECT c.id,c.problem->>'versionId',1,c.problem,
 encode(pg_catalog.sha256(pg_catalog.convert_to(c.problem::text,'UTF8')),'hex')
 FROM competitions c WHERE c.problem->>'versionId' IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM problem_versions p WHERE p.competition_id=c.id);
CREATE OR REPLACE FUNCTION guard_published_problem() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status<>'DRAFT' AND NEW.problem IS DISTINCT FROM OLD.problem THEN
  RAISE EXCEPTION 'Published problem versions are immutable';
 END IF;
 RETURN NEW;
END $$;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='published_problem_guard') THEN
  CREATE TRIGGER published_problem_guard BEFORE UPDATE OF problem ON competitions FOR EACH ROW EXECUTE FUNCTION guard_published_problem();
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS competition_rules_versions (
 id uuid PRIMARY KEY, competition_id uuid NOT NULL REFERENCES competitions(id), sequence integer NOT NULL,
 manifest jsonb NOT NULL, digest text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(competition_id,sequence), UNIQUE(id,competition_id)
);
CREATE TABLE IF NOT EXISTS registry_versions (
 id uuid PRIMARY KEY, competition_id uuid NOT NULL REFERENCES competitions(id), sequence integer NOT NULL,
 registry jsonb NOT NULL, digest text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(competition_id,sequence), UNIQUE(id,competition_id)
);
CREATE TABLE IF NOT EXISTS invitations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), competition_id uuid NOT NULL REFERENCES competitions(id),
 code_hash text NOT NULL UNIQUE, username text NOT NULL, redeemed_by uuid REFERENCES users(id),
 expires_at timestamptz NOT NULL, UNIQUE(competition_id,username)
);
CREATE TABLE IF NOT EXISTS participants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), competition_id uuid NOT NULL REFERENCES competitions(id),
 user_id uuid NOT NULL REFERENCES users(id), workspace_state text NOT NULL DEFAULT 'OPEN'
 CHECK(workspace_state IN ('OPEN','FINALIZING','FINALIZED','NO_SUBMISSION','ACCOUNTING_INCIDENT')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(competition_id,user_id), UNIQUE(id,competition_id)
);
CREATE TABLE IF NOT EXISTS token_accounts (
 participant_id uuid PRIMARY KEY REFERENCES participants(id), allowance bigint NOT NULL DEFAULT 2000000 CHECK(allowance=2000000),
 consumed bigint NOT NULL DEFAULT 0 CHECK(consumed>=0), reserved bigint NOT NULL DEFAULT 0 CHECK(reserved>=0),
 state text NOT NULL DEFAULT 'OPEN' CHECK(state IN ('OPEN','FINALIZING','FINALIZED','ACCOUNTING_INCIDENT')),
 CHECK(state='ACCOUNTING_INCIDENT' OR consumed+reserved<=allowance)
);
CREATE TABLE IF NOT EXISTS attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), competition_id uuid NOT NULL, participant_id uuid NOT NULL,
 version integer NOT NULL, prompt text NOT NULL, prompt_hash text NOT NULL, parent_attempt_id uuid,
 rules_version_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(participant_id,competition_id) REFERENCES participants(id,competition_id),
 FOREIGN KEY(rules_version_id,competition_id) REFERENCES competition_rules_versions(id,competition_id),
 UNIQUE(participant_id,version), UNIQUE(id,participant_id,competition_id)
);
CREATE TABLE IF NOT EXISTS attempt_states (
 attempt_id uuid PRIMARY KEY REFERENCES attempts(id), status text NOT NULL DEFAULT 'QUEUED', public_tests jsonb NOT NULL DEFAULT '[]',
 public_summary text, updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS responses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), attempt_id uuid NOT NULL UNIQUE REFERENCES attempts(id),
 provider_call_id uuid NOT NULL UNIQUE, answer text NOT NULL, answer_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(id,attempt_id)
);
CREATE TABLE IF NOT EXISTS final_selections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), competition_id uuid NOT NULL, participant_id uuid NOT NULL,
 attempt_id uuid NOT NULL, response_id uuid NOT NULL, selected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(participant_id,competition_id) REFERENCES participants(id,competition_id),
 FOREIGN KEY(attempt_id,participant_id,competition_id) REFERENCES attempts(id,participant_id,competition_id),
 FOREIGN KEY(response_id,attempt_id) REFERENCES responses(id,attempt_id),
 UNIQUE(competition_id,participant_id), UNIQUE(id,competition_id)
);
CREATE TABLE IF NOT EXISTS submission_states (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), selection_id uuid NOT NULL UNIQUE REFERENCES final_selections(id),
 status text NOT NULL DEFAULT 'SEALING', effective_decision_id uuid, published_score_id uuid,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS closure_proofs (
 epoch uuid PRIMARY KEY, competition_id uuid NOT NULL UNIQUE REFERENCES competitions(id),
 roster_digest text NOT NULL, selected_ids jsonb NOT NULL, closed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 proof jsonb NOT NULL, UNIQUE(epoch,competition_id)
);
CREATE TABLE IF NOT EXISTS evaluation_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), competition_id uuid NOT NULL, selection_id uuid NOT NULL,
 purpose text NOT NULL CHECK(purpose IN ('QUALITY','CRITICAL_MATCH','CRITICAL_CONTEXT_REVIEW')),
 parent_run_id uuid REFERENCES evaluation_runs(id), closure_epoch uuid, input jsonb NOT NULL,
 input_digest text NOT NULL, model text, status text NOT NULL DEFAULT 'QUEUED',
 failure_reason text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(selection_id,competition_id) REFERENCES final_selections(id,competition_id),
 FOREIGN KEY(closure_epoch,competition_id) REFERENCES closure_proofs(epoch,competition_id),
 CHECK(purpose='QUALITY' OR closure_epoch IS NOT NULL)
);
ALTER TABLE evaluation_runs ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz NOT NULL DEFAULT clock_timestamp();
CREATE TABLE IF NOT EXISTS evaluation_claims (
 selection_id uuid NOT NULL REFERENCES final_selections(id), purpose text NOT NULL,
 revision integer NOT NULL DEFAULT 1, run_id uuid NOT NULL UNIQUE,
 PRIMARY KEY(selection_id,purpose,revision),
 FOREIGN KEY(run_id) REFERENCES evaluation_runs(id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE IF NOT EXISTS provider_calls (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), purpose text NOT NULL CHECK(purpose IN ('GENERATION','QUALITY','REVIEWER')),
 attempt_id uuid REFERENCES attempts(id), evaluation_run_id uuid REFERENCES evaluation_runs(id),
 request_digest text NOT NULL, model text NOT NULL, provider text NOT NULL, request_id text NOT NULL UNIQUE,
 provider_generation_id text, status text NOT NULL DEFAULT 'QUEUED', reserved_tokens bigint NOT NULL DEFAULT 0,
 failure_reason text, dispatched_at timestamptz, completed_at timestamptz,
 CHECK((purpose='GENERATION' AND attempt_id IS NOT NULL AND evaluation_run_id IS NULL)
 OR (purpose<>'GENERATION' AND attempt_id IS NULL AND evaluation_run_id IS NOT NULL))
);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='responses_provider_call_fk') THEN
 ALTER TABLE responses ADD CONSTRAINT responses_provider_call_fk FOREIGN KEY(provider_call_id) REFERENCES provider_calls(id);
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS provider_call_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider_call_id uuid NOT NULL REFERENCES provider_calls(id),
 kind text NOT NULL, raw_evidence jsonb NOT NULL, evidence_digest text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(provider_call_id,kind,evidence_digest)
);
CREATE TABLE IF NOT EXISTS provider_usage_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider_call_id uuid NOT NULL UNIQUE REFERENCES provider_calls(id),
 input_tokens bigint NOT NULL CHECK(input_tokens>=0), output_tokens bigint NOT NULL CHECK(output_tokens>=0),
 total_tokens bigint NOT NULL CHECK(total_tokens=input_tokens+output_tokens), raw_receipt jsonb NOT NULL,
 cost_usd numeric, receipt_digest text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS token_ledger_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), participant_id uuid NOT NULL REFERENCES participants(id),
 provider_call_id uuid REFERENCES provider_calls(id), kind text NOT NULL,
 consumed_delta bigint NOT NULL DEFAULT 0, reserved_delta bigint NOT NULL DEFAULT 0, evidence jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS one_usage_settlement ON token_ledger_events(provider_call_id) WHERE kind='SETTLE';
CREATE TABLE IF NOT EXISTS quality_evaluations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), selection_id uuid NOT NULL UNIQUE REFERENCES final_selections(id),
 evaluation jsonb NOT NULL, judgments jsonb NOT NULL, J numeric, needs_human_review boolean NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS quality_human_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), selection_id uuid NOT NULL REFERENCES final_selections(id),
 actor_id uuid NOT NULL REFERENCES users(id), J numeric NOT NULL CHECK(J BETWEEN 0 AND 1), reason text NOT NULL, ordinal_scores jsonb,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE quality_human_reviews ADD COLUMN IF NOT EXISTS ordinal_scores jsonb;
CREATE TABLE IF NOT EXISTS integrity_detections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), selection_id uuid NOT NULL UNIQUE REFERENCES final_selections(id),
 run_id uuid NOT NULL REFERENCES evaluation_runs(id), detection jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS integrity_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), selection_id uuid NOT NULL UNIQUE REFERENCES final_selections(id),
 run_id uuid NOT NULL REFERENCES evaluation_runs(id), raw_output jsonb NOT NULL, report jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS policy_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), selection_id uuid NOT NULL REFERENCES final_selections(id),
 actor_id uuid NOT NULL REFERENCES users(id), report_id uuid REFERENCES integrity_reports(id),
 mode text NOT NULL CHECK(mode IN ('MACHINE_ASSISTED','HUMAN_ONLY')),
 verdict text NOT NULL CHECK(verdict IN ('NO_VIOLATION','CONFIRMED_VIOLATION','INSUFFICIENT_EVIDENCE')),
 rule_id text, severity text NOT NULL, reason text NOT NULL CHECK(length(reason)>0),
 penalty integer NOT NULL CHECK(penalty IN (0,1,3)), predecessor_id uuid REFERENCES policy_reviews(id),
 failure_provenance text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((mode='MACHINE_ASSISTED' AND report_id IS NOT NULL) OR (mode='HUMAN_ONLY' AND failure_provenance IS NOT NULL)),
 CHECK(verdict='CONFIRMED_VIOLATION' OR penalty=0)
);
CREATE TABLE IF NOT EXISTS appeals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), selection_id uuid NOT NULL REFERENCES final_selections(id),
 challenged_decision_id uuid NOT NULL REFERENCES policy_reviews(id), user_id uuid NOT NULL REFERENCES users(id),
 reason text NOT NULL, status text NOT NULL DEFAULT 'OPEN', resolution_id uuid REFERENCES policy_reviews(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS token_snapshots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), selection_id uuid NOT NULL UNIQUE REFERENCES final_selections(id),
 consumed bigint NOT NULL, ledger_digest text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS score_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), selection_id uuid NOT NULL REFERENCES final_selections(id),
 decision_id uuid NOT NULL REFERENCES policy_reviews(id), token_snapshot_id uuid NOT NULL REFERENCES token_snapshots(id),
 score jsonb NOT NULL, input_digest text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS idempotency_records (
 user_id uuid NOT NULL REFERENCES users(id), operation text NOT NULL, key text NOT NULL,
 request_digest text NOT NULL, response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(user_id,operation,key)
);
CREATE TABLE IF NOT EXISTS outbox_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL, logical_key text NOT NULL, payload jsonb NOT NULL,
 status text NOT NULL DEFAULT 'QUEUED', attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 claimed_at timestamptz, failure_reason text, UNIQUE(kind,logical_key)
);
CREATE INDEX IF NOT EXISTS outbox_ready ON outbox_jobs(status,available_at);
CREATE TABLE IF NOT EXISTS audit_heads (
 competition_id uuid PRIMARY KEY REFERENCES competitions(id), sequence bigint NOT NULL DEFAULT 0, digest text NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), competition_id uuid NOT NULL REFERENCES competitions(id), actor_id uuid REFERENCES users(id),
 sequence bigint NOT NULL, kind text NOT NULL, payload jsonb NOT NULL, previous_digest text NOT NULL, digest text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(competition_id,sequence)
);
CREATE OR REPLACE FUNCTION append_audit(c uuid,a uuid,k text,p jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE h audit_heads%ROWTYPE; next_digest text;
BEGIN
 INSERT INTO audit_heads(competition_id) VALUES(c) ON CONFLICT DO NOTHING;
 SELECT * INTO h FROM audit_heads WHERE competition_id=c FOR UPDATE;
 next_digest := encode(pg_catalog.sha256(pg_catalog.convert_to(h.digest || k || p::text,'UTF8')),'hex');
 INSERT INTO audit_events(competition_id,actor_id,sequence,kind,payload,previous_digest,digest)
 VALUES(c,a,h.sequence+1,k,p,h.digest,next_digest);
 UPDATE audit_heads SET sequence=h.sequence+1,digest=next_digest WHERE competition_id=c;
END $$;
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS problem_deleted boolean NOT NULL DEFAULT false;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS moderation_status text NOT NULL DEFAULT 'ACTIVE' CHECK(moderation_status IN ('ACTIVE','BANNED'));
ALTER TABLE participants ADD COLUMN IF NOT EXISTS public_moderation_notice text;
CREATE TABLE IF NOT EXISTS announcements (
 id uuid PRIMARY KEY, competition_id uuid NOT NULL REFERENCES competitions(id), actor_id uuid NOT NULL REFERENCES users(id),
 message text NOT NULL CHECK(length(message) BETWEEN 1 AND 2000), created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS announcement_states (
 announcement_id uuid PRIMARY KEY REFERENCES announcements(id), withdrawn_at timestamptz
);
CREATE TABLE IF NOT EXISTS moderation_events (
 id uuid PRIMARY KEY, competition_id uuid NOT NULL, participant_id uuid NOT NULL, actor_id uuid NOT NULL REFERENCES users(id),
 action text NOT NULL CHECK(action IN ('BAN','UNBAN')), reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 4000),
 public_notice text NOT NULL CHECK(length(public_notice) BETWEEN 1 AND 2000), confirmed_finding text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(participant_id,competition_id) REFERENCES participants(id,competition_id),
 CHECK(action<>'BAN' OR length(trim(confirmed_finding))>=8)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['competition_rules_versions','registry_versions','problem_versions','provider_call_events','provider_usage_receipts','evaluation_runs','integrity_detections','integrity_reports','token_snapshots','score_revisions'] LOOP
  EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS digest_version text NOT NULL DEFAULT %L',t,'legacy-json-hash-v0');
  EXECUTE format('ALTER TABLE %I ALTER COLUMN digest_version SET DEFAULT %L',t,'sha256-json-c14n-v1');
 END LOOP;
END $$;
ALTER TABLE provider_calls ADD COLUMN IF NOT EXISTS request_digest_version text NOT NULL DEFAULT 'legacy-json-hash-v0';
CREATE OR REPLACE FUNCTION reject_immutable_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Immutable record cannot be changed'; END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['announcements','moderation_events','problem_versions','competition_rules_versions','registry_versions','attempts','responses','final_selections',
 'closure_proofs','evaluation_claims','provider_call_events','provider_usage_receipts','token_ledger_events','quality_evaluations','quality_human_reviews',
 'integrity_detections','integrity_reports','policy_reviews','token_snapshots','score_revisions','audit_events']
 LOOP
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname=t || '_immutable' AND tgrelid=format('battle.%I',t)::regclass) THEN
 EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_immutable_change()',t || '_immutable',t);
 END IF;
 END LOOP;
END $$;
COMMIT;
