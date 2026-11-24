import { TxError } from '../db/pool';

export interface CompetitionRow {
  id: string;
  slug: string;
  title: string;
  capacity: number;
  lifecycle: string;
  rules_version_id: string;
  enrollment_opens_at: string | null;
  generation_cutoff_at: string | null;
  selection_cutoff_at: string | null;
  reveal_at: string | null;
  closure_epoch: string | null;
  closure_recorded_at: string | null;
}

export interface RulesRow {
  id: string;
  version_label: string;
  model_provider: string;
  model_id: string;
  model_revision: string;
  generation_settings: Record<string, unknown>;
  envelope_template: string;
  envelope_digest: string;
  token_allowance: string;
  efficiency_reference_tokens: string;
  max_output_tokens: number;
  input_upper_bound: string;
  provider_qualified: boolean;
  feedback_policy: Record<string, unknown>;
  scoring_formula_version: string;
  penalty_schedule: Record<string, unknown>;
  judge_config: Record<string, unknown>;
  registry_version_id: string | null;
  integrity_policy_version_id: string | null;
  reviewer_model_version_id: string | null;
  matcher_version: string | null;
  manifest_digest: string;
}

export interface ProblemRow {
  competition_problem_id: string;
  problem_version_id: string;
  problem_id: string;
  problem_type: string;
  title: string;
  statement: string;
  objectives: unknown;
  public_constraints: unknown;
  output_contract: unknown;
  public_examples: unknown;
  problem_payload: Record<string, unknown>;
}

export const ENVELOPE_PLACEHOLDER = '{{PROMPT}}';

/**
 * The generator receives exactly this envelope with the participant's prompt
 * substituted. Nothing else: no public statement, no hidden tests, no history.
 */
export function buildEnvelope(rules: RulesRow, prompt: string): string {
  if (!rules.envelope_template.includes(ENVELOPE_PLACEHOLDER)) {
    throw new TxError('RULES_INVALID', 'The frozen envelope has no prompt placeholder', 500);
  }
  return rules.envelope_template.split(ENVELOPE_PLACEHOLDER).join(prompt);
}

/**
 * Upper bound on counted input tokens for the complete request.
 *
 * `bytes` is a proof rather than an estimate: every token of every supported
 * byte-level tokenizer covers at least one byte, so token count <= byte length.
 * It is generous, and that generosity is the price of a strict cap.
 */
export function inputUpperBound(envelopeText: string, mode: 'bytes' | 'chars2'): number {
  const bytes = Buffer.byteLength(envelopeText, 'utf8');
  if (mode === 'chars2') return Math.ceil(bytes / 2);
  return bytes;
}

export interface ReservationPlan {
  envelope: string;
  inputBound: number;
  outputCap: number;
  reserved: number;
  requestDigestInput: string;
}

export function planReservation(
  rules: RulesRow,
  prompt: string,
  mode: 'bytes' | 'chars2'
): ReservationPlan {
  const envelope = buildEnvelope(rules, prompt);
  const inputBound = inputUpperBound(envelope, mode);
  const outputCap = rules.max_output_tokens;
  return {
    envelope,
    inputBound,
    outputCap,
    reserved: inputBound + outputCap,
    requestDigestInput: `${rules.manifest_digest}:${inputBound}:${outputCap}:${envelope}`
  };
}

const PHASE_ORDER = [
  'DRAFT',
  'ENROLLMENT_OPEN',
  'ROSTER_FROZEN',
  'GENERATION_OPEN',
  'GENERATION_CLOSED',
  'SELECTION_CLOSED',
  'RESULTS_REVEALED',
  'CLOSED'
] as const;

export function lifecycleRank(lifecycle: string): number {
  const index = PHASE_ORDER.indexOf(lifecycle as (typeof PHASE_ORDER)[number]);
  return index < 0 ? -1 : index;
}

export function assertGenerationOpen(competition: CompetitionRow, now = new Date()): void {
  if (competition.lifecycle !== 'GENERATION_OPEN') {
    throw new TxError('WORKSPACE_SEALED', `Generation is not open (competition is ${competition.lifecycle})`, 409);
  }
  if (competition.generation_cutoff_at && now > new Date(competition.generation_cutoff_at)) {
    throw new TxError('DEADLINE_PASSED', 'The generation cutoff has passed', 409);
  }
}

export function assertSelectionOpen(competition: CompetitionRow, now = new Date()): void {
  if (lifecycleRank(competition.lifecycle) > lifecycleRank('GENERATION_CLOSED')) {
    throw new TxError('WORKSPACE_SEALED', 'Final selection is closed', 409);
  }
  if (competition.selection_cutoff_at && now > new Date(competition.selection_cutoff_at)) {
    throw new TxError('DEADLINE_PASSED', 'The final-selection cutoff has passed', 409);
  }
}
