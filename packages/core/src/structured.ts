import Decimal from 'decimal.js';
import type { JsonValue, JsonSchemaNode, StructuredCheck, StructuredProblemDraft, StructuredJsonProblem, StructuredProblemIds, StructuredEvaluation, TestResult, RegistryItem } from './types';
import { stableUuid } from './sample';
import { isUuid, validateRegistry } from './integrity';

export const STRUCTURED_PROBLEM_LIMITS = { schemaDepth: 8, schemaNodes: 512, schemaBytes: 32768, answerBytes: 262144, jsonNodes: 20000, statementBytes: 64000, checks: 100, requirements: 100, arrayItems: 1000 } as const;
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const keywords = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'title', 'description']);
const operators = new Set(['exists', 'equals', 'not_equals', 'gte', 'lte', 'one_of', 'contains', 'length_equals', 'unique', 'sum_equals']);
const D = Decimal.clone({ precision: 40 });
const own = (value: object, key: string) => Object.hasOwn(value, key);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
function assertKeys(value: unknown, required: string[], optional: string[], name: string): asserts value is Record<string, unknown> {
  if (!object(value)) throw new Error(`${name} must be an object`);
  if (required.some(key => !own(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) throw new Error(`${name} has missing or unsupported fields`);
}
function boundedString(value: unknown, max: number, name: string, allowEmpty = false): asserts value is string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) throw new Error(`${name} must be a bounded nonempty string`);
}
function identifier(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(value)) throw new Error(`${name} must be a unique alphanumeric identifier of at most 64 characters`);
}
function jsonLiteral(value: unknown, depth = 0, budget = { remaining: STRUCTURED_PROBLEM_LIMITS.jsonNodes }, seen = new Set<object>()): asserts value is JsonValue {
  if (--budget.remaining < 0 || depth > 20) throw new Error('JSON data exceeds safe depth or node limits');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('JSON numbers must be finite'); return; }
  if (typeof value !== 'object' || value === null) throw new Error('Expected literal JSON, not executable or non-JSON data');
  if (seen.has(value)) throw new Error('JSON data must not contain cycles');
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) throw new Error('JSON data must contain plain objects');
  if (Array.isArray(value)) for (let index = 0; index < value.length; index++) if (!own(value, String(index))) throw new Error('Sparse arrays are not literal JSON');
  seen.add(value);
  for (const key of Object.keys(value)) {
    if (forbidden.has(key)) throw new Error('Prototype-related JSON keys are unsupported');
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!('value' in descriptor)) throw new Error('JSON data cannot contain getters or executable accessors');
    jsonLiteral(descriptor.value, depth + 1, budget, seen);
  }
  seen.delete(value);
}
function canonical(value: JsonValue): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function matchesType(value: unknown, type: string): boolean {
  return type === 'null' ? value === null : type === 'array' ? Array.isArray(value) : type === 'object' ? object(value) : type === 'integer' ? typeof value === 'number' && Number.isSafeInteger(value) : type === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeof value === type;
}
export function validateSafeJsonSchema(schema: unknown, depth = 0, budget = { remaining: STRUCTURED_PROBLEM_LIMITS.schemaNodes }): asserts schema is JsonSchemaNode {
  if (--budget.remaining < 0 || depth > STRUCTURED_PROBLEM_LIMITS.schemaDepth) throw new Error('Output schema exceeds safe complexity limits');
  if (!object(schema) || Object.keys(schema).some(key => !keywords.has(key))) throw new Error('Output schema contains unsupported keywords; scripts, regex and references are forbidden');
  if (typeof schema.type !== 'string' || !['object', 'array', 'integer', 'number', 'string', 'boolean', 'null'].includes(schema.type)) throw new Error('Every schema node needs a supported single JSON type');
  if (schema.title !== undefined) boundedString(schema.title, 120, 'Schema title', true);
  if (schema.description !== undefined) boundedString(schema.description, 2000, 'Schema description', true);
  if (schema.enum !== undefined) {
    if (!Array.isArray(schema.enum) || !schema.enum.length || schema.enum.length > 100) throw new Error('Schema enum must be a nonempty bounded literal list');
    const values = new Set<string>();
    for (const value of schema.enum) { jsonLiteral(value); if (!matchesType(value, schema.type)) throw new Error('Enum values must match the declared type'); const key = canonical(value); if (values.has(key)) throw new Error('Enum values must be unique'); values.add(key); }
  }
  if (schema.type === 'object') {
    if (!object(schema.properties) || !Array.isArray(schema.required) || schema.additionalProperties !== false) throw new Error('Every object needs properties, all properties required, and additionalProperties:false');
    const keys = Object.keys(schema.properties);
    if (keys.length > 100 || keys.some(key => !key || key.length > 64 || forbidden.has(key))) throw new Error('Output property names are invalid or excessive');
    if (schema.required.length !== keys.length || new Set(schema.required).size !== keys.length || schema.required.some(key => typeof key !== 'string' || !keys.includes(key))) throw new Error('Every output property must be required exactly once');
    for (const child of Object.values(schema.properties)) validateSafeJsonSchema(child, depth + 1, budget);
  } else if (schema.properties !== undefined || schema.required !== undefined || schema.additionalProperties !== undefined) throw new Error('Object schema keywords require type:object');
  if (schema.type === 'array') {
    if (!object(schema.items) || !Number.isSafeInteger(schema.maxItems) || (schema.maxItems as number) < 0 || (schema.maxItems as number) > STRUCTURED_PROBLEM_LIMITS.arrayItems) throw new Error('Arrays require an items schema and maxItems of at most 1000');
    validateSafeJsonSchema(schema.items, depth + 1, budget);
    if (schema.minItems !== undefined && (!Number.isSafeInteger(schema.minItems) || (schema.minItems as number) < 0 || (schema.minItems as number) > (schema.maxItems as number))) throw new Error('Invalid array minimum');
  } else if (schema.items !== undefined || schema.minItems !== undefined || schema.maxItems !== undefined) throw new Error('Array schema keywords require type:array');
  for (const key of ['minimum', 'maximum']) if (schema[key] !== undefined && (!['number', 'integer'].includes(schema.type) || typeof schema[key] !== 'number' || !Number.isFinite(schema[key]))) throw new Error('Numeric bounds require a finite numeric schema');
  if (typeof schema.minimum === 'number' && typeof schema.maximum === 'number' && schema.minimum > schema.maximum) throw new Error('Numeric minimum exceeds maximum');
  for (const key of ['minLength', 'maxLength']) if (schema[key] !== undefined && (schema.type !== 'string' || !Number.isSafeInteger(schema[key]) || (schema[key] as number) < 0 || (schema[key] as number) > STRUCTURED_PROBLEM_LIMITS.answerBytes)) throw new Error('String bounds require safe nonnegative integer lengths');
  if (typeof schema.minLength === 'number' && typeof schema.maxLength === 'number' && schema.minLength > schema.maxLength) throw new Error('String minimum exceeds maximum');
}
function schemaValue(value: JsonValue, schema: JsonSchemaNode, path = '', depth = 0): void {
  if (depth > STRUCTURED_PROBLEM_LIMITS.schemaDepth || !matchesType(value, schema.type as string)) throw new Error(`Output at ${path || '/'} has the wrong JSON type`);
  if (Array.isArray(schema.enum) && !schema.enum.some(candidate => canonical(candidate as JsonValue) === canonical(value))) throw new Error(`Output at ${path || '/'} is outside the public enum`);
  if (schema.type === 'object') {
    const target = value as Record<string, JsonValue>, properties = schema.properties as Record<string, JsonSchemaNode>;
    if (Object.keys(target).some(key => !own(properties, key)) || (schema.required as string[]).some(key => !own(target, key))) throw new Error(`Output at ${path || '/'} has missing or unexpected properties`);
    for (const key of Object.keys(properties)) schemaValue(target[key], properties[key], `${path}/${key.replace(/~/gu, '~0').replace(/\//gu, '~1')}`, depth + 1);
  }
  if (schema.type === 'array') {
    const values = value as JsonValue[];
    if (values.length < ((schema.minItems as number | undefined) ?? 0) || values.length > (schema.maxItems as number)) throw new Error(`Output array at ${path || '/'} violates its public length bounds`);
    for (const child of values) schemaValue(child, schema.items as JsonSchemaNode, path + '/*', depth + 1);
  }
  if (typeof value === 'number' && ((typeof schema.minimum === 'number' && value < schema.minimum) || (typeof schema.maximum === 'number' && value > schema.maximum))) throw new Error(`Output number at ${path || '/'} violates its public bounds`);
  if (typeof value === 'string') { const length = [...value].length; if ((typeof schema.minLength === 'number' && length < schema.minLength) || (typeof schema.maxLength === 'number' && length > schema.maxLength)) throw new Error(`Output string at ${path || '/'} violates its public length bounds`); }
}
export function parseSafeJsonPointer(path: string): string[] {
  if (typeof path !== 'string' || path.length > 512 || (path !== '' && !path.startsWith('/'))) throw new Error('Check paths must be bounded RFC 6901 JSON Pointers');
  if (path === '') return [];
  const tokens = path.slice(1).split('/');
  if (tokens.length > STRUCTURED_PROBLEM_LIMITS.schemaDepth) throw new Error('JSON Pointer exceeds maximum depth');
  return tokens.map(token => {
    if (/~(?![01])/u.test(token)) throw new Error('Invalid JSON Pointer escape');
    const value = token.replace(/~1/gu, '/').replace(/~0/gu, '~');
    if (value.length > 64 || forbidden.has(value)) throw new Error('Prototype-related or excessive pointer segments are forbidden');
    return value;
  });
}
export function resolveJsonPointer(value: JsonValue, path: string): { found: boolean; value?: JsonValue } {
  let current: JsonValue = value;
  for (const key of parseSafeJsonPointer(path)) {
    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= current.length) return { found: false };
      current = current[Number(key)];
    } else if (current !== null && typeof current === 'object' && own(current, key)) current = current[key];
    else return { found: false };
  }
  return { found: true, value: current };
}
function schemaAt(schema: JsonSchemaNode, path: string): JsonSchemaNode {
  let current = schema;
  for (const key of parseSafeJsonPointer(path)) {
    if (current.type === 'object') {
      const properties = current.properties as Record<string, JsonSchemaNode>;
      if (!own(properties, key)) throw new Error('Check pointer does not exist in the public output schema');
      current = properties[key];
    } else if (current.type === 'array') {
      if (!/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= (current.maxItems as number)) throw new Error('Array check pointer is outside its declared bound');
      current = current.items as JsonSchemaNode;
    } else throw new Error('Check pointer cannot traverse a scalar');
  }
  return current;
}
function validateCheck(check: unknown, requirements: Map<string, 'C' | 'K'>, schema: JsonSchemaNode): asserts check is StructuredCheck {
  assertKeys(check, ['id', 'name', 'requirementId', 'path', 'operator', 'weight', 'essential', 'visibility'], ['expected'], 'Check');
  identifier(check.id, 'Check id'); identifier(check.requirementId, 'Requirement reference'); boundedString(check.name, 120, 'Check name');
  if (!requirements.has(check.requirementId)) throw new Error('Check refers to an unknown public requirement');
  if (typeof check.path !== 'string') throw new Error('A check needs a JSON Pointer');
  const target = schemaAt(schema, check.path);
  if (typeof check.operator !== 'string' || !operators.has(check.operator)) throw new Error('Unsupported check operator; code and scripts are forbidden');
  if (typeof check.weight !== 'number' || !Number.isFinite(check.weight) || check.weight <= 0 || check.weight > 1000) throw new Error('Check weight must be positive and bounded');
  if (typeof check.essential !== 'boolean' || !['public', 'private'].includes(check.visibility as string)) throw new Error('Check essential/visibility flags are invalid');
  if (['exists', 'unique'].includes(check.operator)) { if (own(check, 'expected')) throw new Error('exists and unique checks must omit expected'); }
  else { if (!own(check, 'expected')) throw new Error('This check operator requires a literal JSON expected value'); jsonLiteral(check.expected); }
  if (['gte', 'lte', 'sum_equals'].includes(check.operator) && (typeof check.expected !== 'number' || !Number.isFinite(check.expected))) throw new Error('Numeric checks require a finite expected number');
  if (['gte', 'lte'].includes(check.operator) && !['number', 'integer'].includes(target.type as string)) throw new Error('Numeric bounds need a numeric target');
  if (check.operator === 'length_equals' && (!['string', 'array'].includes(target.type as string) || !Number.isSafeInteger(check.expected) || (check.expected as number) < 0)) throw new Error('Length equality needs a string/array and a nonnegative integer');
  if (check.operator === 'unique' && target.type !== 'array') throw new Error('Uniqueness needs an array target');
  if (check.operator === 'sum_equals' && (target.type !== 'array' || !['number', 'integer'].includes((target.items as JsonSchemaNode).type as string))) throw new Error('Sum equality needs an array of numbers');
  if (check.operator === 'one_of') {
    if (!Array.isArray(check.expected) || !check.expected.length || check.expected.length > 100) throw new Error('one_of needs a nonempty bounded literal JSON array');
    if (check.expected.some(value => !matchesType(value, target.type as string))) throw new Error('one_of values must match the output target type');
  }
  if (check.operator === 'contains' && (target.type !== 'string' && target.type !== 'array')) throw new Error('contains needs a string or array');
  if (check.operator === 'contains' && target.type === 'string' && typeof check.expected !== 'string') throw new Error('String containment needs a literal string');
}
function checkValue(answer: JsonValue, check: StructuredCheck): boolean {
  const result = resolveJsonPointer(answer, check.path);
  if (check.operator === 'exists') return result.found;
  if (!result.found) return false;
  const value = result.value!;
  switch (check.operator) {
    case 'equals': return canonical(value) === canonical(check.expected!);
    case 'not_equals': return canonical(value) !== canonical(check.expected!);
    case 'gte': return typeof value === 'number' && new D(value).gte(check.expected as number);
    case 'lte': return typeof value === 'number' && new D(value).lte(check.expected as number);
    case 'one_of': return (check.expected as JsonValue[]).some(expected => canonical(value) === canonical(expected));
    case 'contains': return typeof value === 'string' ? value.includes(check.expected as string) : Array.isArray(value) && value.some(entry => canonical(entry) === canonical(check.expected!));
    case 'length_equals': return (typeof value === 'string' ? [...value].length : Array.isArray(value) ? value.length : -1) === check.expected;
    case 'unique': return Array.isArray(value) && new Set(value.map(canonical)).size === value.length;
    case 'sum_equals': return Array.isArray(value) && value.every(entry => typeof entry === 'number') && value.reduce<Decimal>((sum, entry) => sum.plus(entry as number), new D(0)).eq(check.expected as number);
    default: return false;
  }
}
function parseAnswer(raw: unknown, schema: JsonSchemaNode): JsonValue {
  if (typeof raw === 'string' && Buffer.byteLength(raw, 'utf8') > STRUCTURED_PROBLEM_LIMITS.answerBytes) throw new Error('Generated JSON answer exceeds its safe size limit');
  const value: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
  jsonLiteral(value);
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > STRUCTURED_PROBLEM_LIMITS.answerBytes) throw new Error('Generated JSON answer exceeds its safe size limit');
  schemaValue(value, schema);
  const rationale = (value as Record<string, JsonValue>).rationale;
  if (typeof rationale !== 'string' || rationale.trim().split(/\s+/u).filter(Boolean).length > 120) throw new Error('A top-level rationale string of at most 120 words is required');
  return value;
}
export function validateStructuredProblemDraft(raw: unknown): StructuredProblemDraft {
  jsonLiteral(raw);
  if (Buffer.byteLength(JSON.stringify(raw), 'utf8') > 524288) throw new Error('Problem draft exceeds its safe size limit');
  assertKeys(raw, ['kind', 'title', 'statement', 'objectives', 'constraints', 'requirements', 'outputSchema', 'checks', 'referenceAnswer'], [], 'Structured problem draft');
  if (raw.kind !== 'STRUCTURED_JSON') throw new Error('This editor accepts STRUCTURED_JSON problems only');
  boundedString(raw.title, 160, 'Problem title'); boundedString(raw.statement, 32000, 'Problem statement');
  for (const key of ['objectives', 'constraints'] as const) { if (!Array.isArray(raw[key]) || raw[key].length > 50) throw new Error(`${key} must be a bounded string list`); for (const text of raw[key]) boundedString(text, 2000, key); }
  validateSafeJsonSchema(raw.outputSchema);
  if (Buffer.byteLength(JSON.stringify(raw.outputSchema), 'utf8') > STRUCTURED_PROBLEM_LIMITS.schemaBytes) throw new Error('Output schema exceeds its size limit');
  if (raw.outputSchema.type !== 'object' || !object(raw.outputSchema.properties) || !object(raw.outputSchema.properties.rationale) || raw.outputSchema.properties.rationale.type !== 'string') throw new Error('Output schema needs a required top-level rationale:string');
  if (!Array.isArray(raw.requirements) || !raw.requirements.length || raw.requirements.length > STRUCTURED_PROBLEM_LIMITS.requirements) throw new Error('Define a bounded public requirement list');
  const requirements = new Map<string, 'C' | 'K'>(), requirementTexts = new Map<string, 'C' | 'K'>();
  for (const requirement of raw.requirements) {
    assertKeys(requirement, ['id', 'text', 'group'], [], 'Public requirement'); identifier(requirement.id, 'Requirement id'); boundedString(requirement.text, 2000, 'Requirement text');
    if (requirement.id === 'required-output-contract' || !['C', 'K'].includes(requirement.group as string) || requirements.has(requirement.id)) throw new Error('Requirement ids must be unique and own one C/K group');
    const text = requirement.text.normalize('NFC').replace(/\s+/gu, ' ').trim();
    if (requirementTexts.has(text) && requirementTexts.get(text) !== requirement.group) throw new Error('An identical public requirement cannot be scored in both C and K');
    requirements.set(requirement.id, requirement.group as 'C' | 'K'); requirementTexts.set(text, requirement.group as 'C' | 'K');
  }
  if (!Array.isArray(raw.checks) || !raw.checks.length || raw.checks.length > STRUCTURED_PROBLEM_LIMITS.checks) throw new Error('Define a bounded deterministic check list');
  const validatedChecks: StructuredCheck[] = [];
  const ids = new Set<string>(['structured-output-contract']), signatures = new Map<string, 'C' | 'K'>(), weights = { C: 0, K: 0 };
  for (const check of raw.checks) {
    validateCheck(check, requirements, raw.outputSchema);
    validatedChecks.push(check);
    if (ids.has(check.id)) throw new Error('Check ids must be unique'); ids.add(check.id);
    const group = requirements.get(check.requirementId)!;
    const signature = JSON.stringify([check.path, check.operator, own(check, 'expected') ? canonical(check.expected!) : null]);
    if (signatures.has(signature) && signatures.get(signature) !== group) throw new Error('An identical deterministic check cannot count in both C and K');
    signatures.set(signature, group); weights[group] += check.weight;
  }
  if (weights.C <= 0 || weights.K <= 0) throw new Error('Both C and K need authored positive-weight checks; automatic schema validation is distinct');
  for (const requirementId of requirements.keys()) if (!validatedChecks.some(check => check.requirementId === requirementId)) throw new Error('Each scored public requirement needs a deterministic check');
  const reference = parseAnswer(raw.referenceAnswer, raw.outputSchema);
  for (const check of validatedChecks) if (!checkValue(reference, check)) throw new Error(`Private reference answer fails configured check ${check.id}`);
  const draft = JSON.parse(JSON.stringify(raw)) as StructuredProblemDraft;
  if (Buffer.byteLength(composeStatement(draft).statement, 'utf8') > STRUCTURED_PROBLEM_LIMITS.statementBytes) throw new Error('Composed public problem exceeds 64000 UTF-8 bytes');
  return draft;
}
const outputContract = 'Return one JSON object conforming to the public output schema. Every declared field is required and additional fields are forbidden. Include a top-level rationale string of at most 120 words. Generated answers are immutable. Automatic JSON structure/rationale validation is a public C format gate of weight 1; configured checks separately assess the stated solution requirements.';
function composeStatement(draft: StructuredProblemDraft): { statement: string; requiredSpans: Array<{ id: string; text: string; startByte: number; endByte: number }> } {
  let statement = `${draft.title}\n\n${draft.statement}\n`;
  const requiredSpans: Array<{ id: string; text: string; startByte: number; endByte: number }> = [];
  if (draft.objectives.length) statement += '\nObjectives\n' + draft.objectives.map(value => '- ' + value).join('\n') + '\n';
  if (draft.constraints.length) statement += '\nConstraints\n' + draft.constraints.map(value => '- ' + value).join('\n') + '\n';
  statement += '\nScored public requirements\n';
  for (const requirement of draft.requirements) {
    const checks = draft.checks.filter(check => check.requirementId === requirement.id);
    const weight = checks.reduce((sum, check) => sum + check.weight, 0), essential = checks.some(check => check.essential);
    statement += `${requirement.id} [${requirement.group}; weight ${weight}; ${essential ? 'essential' : 'graded'}]: `;
    const startByte = Buffer.byteLength(statement, 'utf8'); statement += requirement.text;
    requiredSpans.push({ id: requirement.id, text: requirement.text, startByte, endByte: Buffer.byteLength(statement, 'utf8') }); statement += '\n';
  }
  statement += '\nPublic output contract\n';
  const startByte = Buffer.byteLength(statement, 'utf8'); statement += outputContract;
  requiredSpans.push({ id: 'required-output-contract', text: outputContract, startByte, endByte: Buffer.byteLength(statement, 'utf8') });
  statement += '\n\nPublic JSON output schema\n' + JSON.stringify(draft.outputSchema, null, 2);
  return { statement, requiredSpans };
}
export function buildStructuredProblem(raw: unknown, ids: StructuredProblemIds): StructuredJsonProblem {
  const draft = validateStructuredProblemDraft(raw);
  for (const id of [ids.problemId, ids.versionId]) boundedString(id, 128, 'Problem/version identity');
  for (const id of [ids.registryId, ids.registryVersionId, ids.policyVersionId]) if (!isUuid(id)) throw new Error('Registry/policy identities must be UUIDs');
  const composed = composeStatement(draft);
  const items: RegistryItem[] = composed.requiredSpans.map(span => ({
    id: stableUuid(`${ids.registryVersionId}:required:${span.id}`), category: 'REQUIRED_INFORMATION', text: span.text,
    sourceStartByte: span.startByte, sourceEndByte: span.endByte, explanation: 'Public information required by this problem and always reusable.'
  }));
  items.push({ id: stableUuid(`${ids.registryVersionId}:private-checks`), category: 'PRIVATE_EVALUATION_CRITERIA', privateReference: `structured-json-checks:${ids.versionId}` });
  const registry = { id: ids.registryId, versionId: ids.registryVersionId, policyVersionId: ids.policyVersionId, sourceText: composed.statement, items, partialMinCodePoints: 32 };
  validateRegistry(registry);
  return {
    kind: 'STRUCTURED_JSON', id: ids.problemId, versionId: ids.versionId, title: draft.title, statement: composed.statement,
    structured: { baseStatement: draft.statement, objectives: draft.objectives, constraints: draft.constraints, requirements: draft.requirements, outputSchema: draft.outputSchema, checks: draft.checks, referenceAnswer: draft.referenceAnswer },
    registry, publicRules: {
      copyingPolicy: 'All necessary public facts, constraints, output keys and required information may be reused. This new problem begins with no protected passages. Any future nonessential protected passage must be explicitly designated under a public rule before publication; integrity review occurs only after competition-wide closure.',
      penaltySchedule: 'No violation: 0 points. A confirmed minor violation: 1 point. A confirmed material violation: 3 points. The copying deduction is capped at 3 points per final submission.',
      outputContract
    }
  };
}
export function validateStructuredAnswer(raw: unknown, problem: StructuredJsonProblem): JsonValue {
  return parseAnswer(raw, problem.structured.outputSchema);
}
export function evaluateStructuredJsonAnswer(raw: unknown, problem: StructuredJsonProblem): StructuredEvaluation {
  const config = problem.structured;
  // Invalid problem configuration is an infrastructure error, not a participant failure.
  validateStructuredProblemDraft({ kind: 'STRUCTURED_JSON', title: problem.title, statement: config.baseStatement, objectives: config.objectives, constraints: config.constraints, requirements: config.requirements, outputSchema: config.outputSchema, checks: config.checks, referenceAnswer: config.referenceAnswer });
  const format: TestResult = { id: 'structured-output-contract', name: 'Public JSON output contract', passed: false, essential: true, weight: 1, group: 'C', visibility: 'public', detail: 'The public JSON schema and rationale requirement must pass.' };
  let answer: JsonValue;
  try { answer = parseAnswer(raw, config.outputSchema); }
  catch (error) { format.detail = error instanceof Error ? error.message : 'Invalid structured output'; return { parsed: null, publicTests: [format], finalTests: [format], C: 0, K: 0, eligible: false, computedCost: null, summary: 'The public output contract failed.' }; }
  format.passed = true; format.detail = 'Public JSON structure and rationale requirements passed.';
  const groups = new Map(config.requirements.map(requirement => [requirement.id, requirement.group]));
  const checks: TestResult[] = config.checks.map(check => ({ id: check.id, name: check.name, passed: checkValue(answer, check), essential: check.essential, weight: check.weight, group: groups.get(check.requirementId)!, visibility: check.visibility, detail: 'This deterministic check is evaluated against its declared public requirement.' }));
  const finalTests = [format, ...checks];
  const component = (group: 'C' | 'K') => { const tests = finalTests.filter(test => test.group === group); return tests.reduce((sum, test) => sum + (test.passed ? test.weight : 0), 0) / tests.reduce((sum, test) => sum + test.weight, 0); };
  return { parsed: answer, publicTests: finalTests.filter(test => test.visibility === 'public'), finalTests, C: component('C'), K: component('K'), eligible: finalTests.filter(test => test.essential).every(test => test.passed), computedCost: null, summary: 'Structured JSON checks completed under the frozen problem definition.' };
}