BEGIN;
SET search_path TO battle;
ALTER TABLE evaluation_runs DROP CONSTRAINT IF EXISTS evaluation_runs_purpose_check;
ALTER TABLE evaluation_runs DROP CONSTRAINT IF EXISTS evaluation_runs_purpose_v3;
ALTER TABLE evaluation_runs ADD CONSTRAINT evaluation_runs_purpose_v3 CHECK(purpose IN ('QUALITY','CRITICAL_MATCH','CRITICAL_CONTEXT_REVIEW') OR purpose ~ '^CRITICAL_APPEAL_REVIEW:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
ALTER TABLE policy_reviews ALTER COLUMN actor_id DROP NOT NULL;
DO $$ DECLARE c record; BEGIN FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='battle.policy_reviews'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%mode%' LOOP EXECUTE format('ALTER TABLE policy_reviews DROP CONSTRAINT %I',c.conname); END LOOP; END $$;
ALTER TABLE policy_reviews ADD CONSTRAINT policy_reviews_mode_v3 CHECK(mode IN ('MACHINE_ASSISTED','HUMAN_ONLY','AUTOMATIC_REVIEWER'));
ALTER TABLE policy_reviews ADD CONSTRAINT policy_reviews_provenance_v3 CHECK((mode='AUTOMATIC_REVIEWER' AND actor_id IS NULL AND report_id IS NOT NULL) OR (mode='MACHINE_ASSISTED' AND actor_id IS NOT NULL AND report_id IS NOT NULL) OR (mode='HUMAN_ONLY' AND actor_id IS NOT NULL AND failure_provenance IS NOT NULL));
ALTER TABLE policy_reviews ADD COLUMN IF NOT EXISTS rule_ids jsonb NOT NULL DEFAULT '[]';
ALTER TABLE policy_reviews ADD COLUMN IF NOT EXISTS evidence_ids jsonb NOT NULL DEFAULT '[]';
ALTER TABLE integrity_reports ADD COLUMN IF NOT EXISTS review_revision integer NOT NULL DEFAULT 1 CHECK(review_revision>0);
ALTER TABLE integrity_reports ADD COLUMN IF NOT EXISTS appeal_id uuid REFERENCES appeals(id);
ALTER TABLE integrity_reports DROP CONSTRAINT IF EXISTS integrity_reports_selection_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS integrity_report_revision ON integrity_reports(selection_id,review_revision);
CREATE TABLE IF NOT EXISTS solving_timings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),selection_id uuid NOT NULL UNIQUE REFERENCES final_selections(id),first_correct_attempt_id uuid REFERENCES attempts(id),first_correct_at timestamptz,elapsed_ms bigint CHECK(elapsed_ms>=0),problem_version_id text NOT NULL,evidence_digest text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),CHECK((first_correct_at IS NULL AND elapsed_ms IS NULL AND first_correct_attempt_id IS NULL) OR (first_correct_at IS NOT NULL AND elapsed_ms IS NOT NULL AND first_correct_attempt_id IS NOT NULL)));
ALTER TABLE solving_timings ALTER COLUMN problem_version_id TYPE text USING problem_version_id::text;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='solving_timings_immutable' AND tgrelid='battle.solving_timings'::regclass) THEN CREATE TRIGGER solving_timings_immutable BEFORE UPDATE OR DELETE ON solving_timings FOR EACH ROW EXECUTE FUNCTION reject_immutable_change(); END IF; END $$;
CREATE OR REPLACE FUNCTION guard_published_problem() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE nm jsonb; om jsonb;
BEGIN
 IF OLD.status<>'DRAFT' AND NEW.problem IS DISTINCT FROM OLD.problem THEN
  IF current_setting('prompt_battle.allow_problem_revision',true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'Published problem versions are immutable; append a linked revision'; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.closure_epoch IS DISTINCT FROM OLD.closure_epoch OR NEW.rules_version_id=OLD.rules_version_id THEN RAISE EXCEPTION 'Problem editing cannot reopen or rewrite a competition'; END IF;
  SELECT manifest INTO nm FROM competition_rules_versions WHERE id=NEW.rules_version_id AND competition_id=OLD.id;
  SELECT manifest INTO om FROM competition_rules_versions WHERE id=OLD.rules_version_id AND competition_id=OLD.id;
  IF nm IS NULL OR (nm-'problemKind'-'problemRevision'-'problemVersionId'-'problemDigest'-'outputSchemaDigest'-'checksDigest'-'registryVersionId') IS DISTINCT FROM (om-'problemKind'-'problemRevision'-'problemVersionId'-'problemDigest'-'outputSchemaDigest'-'checksDigest'-'registryVersionId') THEN RAISE EXCEPTION 'Live editing cannot change frozen model, review, timing, budgets or schedules'; END IF;
  IF NOT EXISTS(SELECT 1 FROM problem_versions WHERE competition_id=OLD.id AND version_id=(nm->>'problemVersionId') AND content=NEW.problem) OR NOT EXISTS(SELECT 1 FROM registry_versions WHERE competition_id=OLD.id AND id=NEW.registry_version_id AND id=(nm->>'registryVersionId')::uuid AND registry=NEW.problem->'registry') THEN RAISE EXCEPTION 'Problem revision must reference immutable matching competition records'; END IF;
 END IF;
 RETURN NEW;
END $$;
COMMIT;