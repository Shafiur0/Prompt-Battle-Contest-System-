export type InformationCategory =
  | 'PROTECTED_CRITICAL_INFORMATION'
  | 'ALLOWED_PUBLIC_INFORMATION'
  | 'REQUIRED_INFORMATION'
  | 'PRIVATE_EVALUATION_CRITERIA';

export interface TextRange {
  startByte: number;
  endByte: number;
  quote: string;
}

export interface RegistryItem {
  id: string;
  category: InformationCategory;
  text?: string;
  sourceStartByte?: number;
  sourceEndByte?: number;
  publicRuleId?: string;
  explanation?: string;
  severity?: 'NONE' | 'MINOR' | 'MATERIAL';
  privateReference?: string;
}

export interface CriticalRegistry {
  id: string;
  versionId: string;
  policyVersionId: string;
  sourceText: string;
  items: RegistryItem[];
  partialMinCodePoints: number;
}

export interface AllocationData {
  depots: Record<string, { stock: number; minimumReserve: number }>;
  orders: Record<string, { demand: number }>;
  routes: Array<{ depot: string; order: string; capacity: number; unitCost: number }>;
  optimalCost: number;
}

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonSchemaNode = Record<string, unknown>;
export interface ScoredRequirement { id: string; text: string; group: 'C' | 'K' }
export type StructuredCheckOperator = 'exists' | 'equals' | 'not_equals' | 'gte' | 'lte' | 'one_of' | 'contains' | 'length_equals' | 'unique' | 'sum_equals';
export interface StructuredCheck {
  id: string;
  name: string;
  requirementId: string;
  path: string;
  operator: StructuredCheckOperator;
  expected?: JsonValue;
  weight: number;
  essential: boolean;
  visibility: 'public' | 'private';
}
export interface StructuredProblemDraft {
  kind: 'STRUCTURED_JSON';
  title: string;
  statement: string;
  objectives: string[];
  constraints: string[];
  requirements: ScoredRequirement[];
  outputSchema: JsonSchemaNode;
  checks: StructuredCheck[];
  referenceAnswer: JsonValue;
}
export interface StructuredProblemConfig {
  baseStatement: string;
  objectives: string[];
  constraints: string[];
  requirements: ScoredRequirement[];
  outputSchema: JsonSchemaNode;
  checks: StructuredCheck[];
  referenceAnswer: JsonValue;
}
export interface ProblemBase {
  id: string;
  versionId: string;
  title: string;
  statement: string;
  registry: CriticalRegistry;
  publicRules: { copyingPolicy: string; penaltySchedule: string; outputContract: string };
}
export interface AllocationProblem extends ProblemBase {
  kind?: 'ALLOCATION';
  data: AllocationData;
}
export interface StructuredJsonProblem extends ProblemBase {
  kind: 'STRUCTURED_JSON';
  structured: StructuredProblemConfig;
}
export type CompetitionProblem = AllocationProblem | StructuredJsonProblem;

export interface AllocationAnswer {
  allocations: Array<{ depot: string; order: string; units: number }>;
  rationale: string;
}

export interface TestResult {
  id: string;
  name: string;
  passed: boolean;
  essential: boolean;
  weight: number;
  group: 'C' | 'K';
  visibility: 'public' | 'private';
  detail: string;
}

export interface AllocationEvaluation {
  parsed: AllocationAnswer | null;
  publicTests: TestResult[];
  finalTests: TestResult[];
  C: number;
  K: number;
  eligible: boolean;
  computedCost: number | null;
  summary: string;
}

export type MatchMethod = 'EXACT' | 'NORMALIZED' | 'PARTIAL' | 'COMPATIBILITY_CANDIDATE' | 'CONTEXT';
export interface CopyMatch {
  id: string;
  itemId: string;
  method: MatchMethod;
  promptRange: TextRange;
  sourceRange: TextRange;
  sourceCoverage: number;
  exempt: boolean;
}

export interface CopyDetectionReport {
  promptHash: string;
  registryVersionId: string;
  normalizerVersion: string;
  copyRatio: number;
  matches: CopyMatch[];
  allowedMatches: CopyMatch[];
  contextEvidence: CopyMatch[];
  sourceCoverage: Record<string, number>;
  coverageComplete: boolean;
  warnings: string[];
}

export interface CompetitionClosure {
  epoch: string;
  enrollmentClosed: boolean;
  rosterFrozen: boolean;
  generationWindowClosed: boolean;
  selectionWindowClosed: boolean;
  allWorkspacesClosed: boolean;
}

export interface RawAllowedMatch {
  item_id: string | null;
  evidence_ids: string[];
  reason_code: 'REQUIRED_FACT' | 'ALLOWED_FACT' | 'COMMON_TERMINOLOGY' | 'PUBLISHED_EXCEPTION';
}

export interface RawReviewerOutput {
  verdict: 'NO_VIOLATION' | 'POSSIBLE_VIOLATION' | 'INSUFFICIENT_EVIDENCE';
  confidence: number | null;
  allowed_information_matches: RawAllowedMatch[];
  original_contribution_summary: string;
  evidence: Array<{
    evidence_id: string;
    classification: 'PROTECTED_CANDIDATE' | 'PERMITTED_REUSE' | 'UNCERTAIN';
    summary: string;
  }>;
  reasoning_summary: string;
  recommended_penalty: 'NONE' | 'REFER_TO_PUBLISHED_PENALTY_RULE';
}

export interface ReviewServerContext {
  competitionId: string;
  participantId: string;
  selectedAttemptId: string;
  reviewerModelVersionId: string;
  closure: CompetitionClosure;
  prompt: string;
  problem: CompetitionProblem;
  detection: CopyDetectionReport;
}

export interface HumanIntegrityDecision {
  verdict: 'NO_VIOLATION' | 'CONFIRMED_VIOLATION' | 'INSUFFICIENT_EVIDENCE';
  adjudicationMode: 'MACHINE_ASSISTED' | 'HUMAN_ONLY';
  reviewedBy: string;
  ruleId?: string;
  severity?: 'NONE' | 'MINOR' | 'MATERIAL';
  reason: string;
  reportId?: string | null;
  failureProvenance?: string;
}

export interface QualityJudgeOutput {
  verdict: 'VALID' | 'UNCERTAIN';
  scores: { clarity: number; justification: number; conciseness: number };
  evidence: Array<{ criterion: 'clarity' | 'justification' | 'conciseness'; quote: string }>;
  reasoning_summary: string;
}
export interface StructuredEvaluation {
  parsed: JsonValue | null;
  publicTests: TestResult[];
  finalTests: TestResult[];
  C: number;
  K: number;
  eligible: boolean;
  computedCost: null;
  summary: string;
}
export type AnswerEvaluation = AllocationEvaluation | StructuredEvaluation;
export interface StructuredProblemIds {
  problemId: string;
  versionId: string;
  registryId: string;
  registryVersionId: string;
  policyVersionId: string;
}