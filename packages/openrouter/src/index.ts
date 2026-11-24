import { randomUUID } from 'node:crypto';

export const DEFAULT_OPENROUTER_URL = 'https://openrouter.ai/api/v1';
export const GENERATOR_MODEL_ID = 'deepseek/deepseek-v4.1-flash-1017';
export const REVIEWER_MODEL_ID = 'anthropic/claude-sonnet-5.5';

export type FailureClassification = 'DEFINITIVE_REJECTION' | 'AMBIGUOUS';
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
}
export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface CompleteInput {
  model: string;
  provider: string;
  messages: ChatMessage[];
  maxOutputTokens: number;
  jsonSchema?: object;
  schemaName?: string;
  temperature?: number;
  // Correlation only. OpenRouter idempotency is not assumed or claimed.
  requestId?: string;
}
export interface CompletionResult {
  id: string;
  model: string;
  content: string;
  usage?: TokenUsage;
  rawReceipt: unknown;
  clientRequestId: string;
  provider?: string;
  finishReason?: string;
}
export interface RecoveryResult {
  id: string;
  model: string;
  usage?: TokenUsage;
  rawReceipt: unknown;
  provider?: string;
  // /generation exposes statistics, not the generated answer text.
}
export interface CatalogModel {
  id: string;
  name: string;
  contextLength?: number;
  supportedParameters: string[];
  pricing?: Record<string, string>;
}
export interface OpenRouterClientOptions {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof globalThis.fetch;
  appName?: string;
  siteUrl?: string;
}
export interface ErrorEvidence {
  status?: number;
  clientRequestId?: string;
  generationId?: string;
  rawReceipt?: unknown;
  usage?: TokenUsage;
  dispatched?: boolean;
}
export class OpenRouterError extends Error {
  readonly classification: FailureClassification;
  readonly kind: FailureClassification;
  readonly code: string;
  readonly status?: number;
  readonly clientRequestId?: string;
  readonly generationId?: string;
  readonly rawReceipt?: unknown;
  readonly usage?: TokenUsage;
  readonly dispatched: boolean;
  constructor(code: string, classification: FailureClassification, message: string, evidence: ErrorEvidence = {}) {
    super(message);
    this.name = 'OpenRouterError'; this.code = code; this.classification = classification; this.kind = classification;
    this.status = evidence.status; this.clientRequestId = evidence.clientRequestId; this.generationId = evidence.generationId;
    this.rawReceipt = evidence.rawReceipt; this.usage = evidence.usage; this.dispatched = evidence.dispatched ?? false;
  }
}

function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function safeToken(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function safeCost(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
function opaqueId(value: unknown): value is string { return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/u.test(value); }
function modelId(value: unknown): value is string { return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_./:-]{0,255}$/u.test(value); }
function usageFromFields(input: unknown, output: unknown, total: unknown, cost: unknown, cached: unknown, reasoning: unknown): TokenUsage | undefined {
  if (input === undefined || input === null || output === undefined || output === null) return undefined;
  if (!safeToken(input) || !safeToken(output) || !Number.isSafeInteger(input + output)) throw new Error('Invalid provider token quantities');
  const sum = input + output;
  if (total !== undefined && total !== null && (!safeToken(total) || total !== sum)) throw new Error('Provider total tokens disagree with input/output usage');
  if (cost !== undefined && cost !== null && !safeCost(cost)) throw new Error('Invalid reported cost');
  if (cached !== undefined && cached !== null && (!safeToken(cached) || cached > input)) throw new Error('Cached input is not a valid input-token subset');
  if (reasoning !== undefined && reasoning !== null && (!safeToken(reasoning) || reasoning > output)) throw new Error('Reasoning tokens are not a valid output-token subset');
  return { inputTokens: input, outputTokens: output, totalTokens: sum,
    ...(safeCost(cost) ? { costUsd: cost } : {}),
    ...(safeToken(cached) ? { cachedInputTokens: cached } : {}),
    ...(safeToken(reasoning) ? { reasoningTokens: reasoning } : {}) };
}
export function normalizeCompletionUsage(raw: unknown): TokenUsage | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!record(raw)) throw new Error('Invalid provider usage object');
  const promptDetails = record(raw.prompt_tokens_details) ? raw.prompt_tokens_details : {};
  const completionDetails = record(raw.completion_tokens_details) ? raw.completion_tokens_details : {};
  return usageFromFields(raw.prompt_tokens, raw.completion_tokens, raw.total_tokens, raw.cost, promptDetails.cached_tokens, completionDetails.reasoning_tokens);
}
export function normalizeRecoveryUsage(raw: unknown): TokenUsage | undefined {
  if (!record(raw)) return undefined;
  if (record(raw.usage)) return normalizeCompletionUsage(raw.usage);
  // Prefer native provider counts. OpenRouter's separately tokenized statistics are
  // not silently substituted for the participant's provider-usage contract.
  return usageFromFields(raw.native_tokens_prompt, raw.native_tokens_completion, undefined, raw.total_cost, raw.native_tokens_cached, raw.native_tokens_reasoning);
}
function errorCode(raw: unknown): string | undefined {
  if (!record(raw) || !record(raw.error)) return undefined;
  const code = raw.error.code;
  return typeof code === 'string' || typeof code === 'number' ? String(code) : undefined;
}
function generationId(raw: unknown): string | undefined {
  if (!record(raw)) return undefined;
  return opaqueId(raw.id) ? raw.id : undefined;
}
export function classifyHttpFailure(status: number, raw: unknown): FailureClassification {
  if (!record(raw) || !record(raw.error) || generationId(raw) || record(raw.usage)) return 'AMBIGUOUS';
  const metadata = record(raw.error.metadata) ? raw.error.metadata : {};
  if (metadata.provider_name || metadata.provider || metadata.raw) return 'AMBIGUOUS';
  // Only recognizable gateway rejection statuses without execution evidence.
  return [400, 401, 402, 403, 404, 413, 422, 429].includes(status) ? 'DEFINITIVE_REJECTION' : 'AMBIGUOUS';
}

export class OpenRouterClient {
  readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly appName: string;
  private readonly siteUrl: string;
  constructor(options: OpenRouterClientOptions = {}) {
    const base = new URL(options.baseUrl ?? DEFAULT_OPENROUTER_URL);
    if (base.username || base.password || base.search || base.hash || !['https:', 'http:'].includes(base.protocol)) throw new Error('OpenRouter base URL must be an HTTP URL without credentials or query parameters');
    this.baseUrl = base.toString().replace(/\/$/u, '');
    this.apiKey = options.apiKey?.trim() || undefined;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 600_000) throw new Error('Invalid OpenRouter timeout');
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.appName = options.appName ?? 'AI Prompt Battle Local';
    this.siteUrl = options.siteUrl ?? 'http://localhost';
    if (/\r|\n/u.test(this.appName + this.siteUrl)) throw new Error('Invalid application header values');
  }
  private async request(path: string, options: { method: 'GET' | 'POST'; body?: object; authenticated: boolean; clientRequestId: string }): Promise<unknown> {
    if (options.authenticated && !this.apiKey) throw new OpenRouterError('MISSING_API_KEY', options.method === 'POST' ? 'DEFINITIVE_REJECTION' : 'AMBIGUOUS', 'Configure the server-side OpenRouter API key before making AI requests.', { clientRequestId: options.clientRequestId, dispatched: false });
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const operation = async () => {
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method: options.method,
          headers: { Accept: 'application/json', ...(options.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
            'X-Title': this.appName, 'HTTP-Referer': this.siteUrl,
            ...(options.authenticated ? { Authorization: `Bearer ${this.apiKey}` } : {}) },
          ...(options.body ? { body: JSON.stringify(options.body) } : {}), signal: controller.signal
        });
      } catch {
        throw new OpenRouterError(controller.signal.aborted ? 'REQUEST_TIMEOUT' : 'NETWORK_OUTCOME_UNKNOWN', 'AMBIGUOUS', 'The OpenRouter request outcome is unknown; preserve the reservation and reconcile provider evidence.', { clientRequestId: options.clientRequestId, dispatched: true });
      }
      let raw: unknown;
      try { raw = await response.json(); }
      catch { throw new OpenRouterError('INVALID_HTTP_RECEIPT', 'AMBIGUOUS', 'OpenRouter returned an unreadable receipt; processing and usage must be reconciled.', { status: response.status, clientRequestId: options.clientRequestId, dispatched: true }); }
      if (!response.ok || errorCode(raw) !== undefined) {
        let usage: TokenUsage | undefined;
        try { usage = record(raw) ? normalizeCompletionUsage(raw.usage) : undefined; } catch { /* Preserve raw evidence; do not invent usage. */ }
        const classification = response.ok || options.method === 'GET' ? 'AMBIGUOUS' : classifyHttpFailure(response.status, raw);
        throw new OpenRouterError(`HTTP_${response.status}`, classification, classification === 'DEFINITIVE_REJECTION' ? `OpenRouter rejected the request before generation (HTTP ${response.status}).` : `OpenRouter returned an uncertain generation failure (HTTP ${response.status}); reconcile its receipt.`,
          { status: response.status, clientRequestId: options.clientRequestId, generationId: generationId(raw), rawReceipt: raw, usage, dispatched: true });
      }
      return raw;
    };
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new OpenRouterError('REQUEST_TIMEOUT', 'AMBIGUOUS', 'The OpenRouter deadline elapsed; the provider may still have processed the request.', { clientRequestId: options.clientRequestId, dispatched: true })); }, this.timeoutMs);
    });
    try { return await Promise.race([operation(), timeout]); }
    finally { if (timer) clearTimeout(timer); }
  }
  async complete(input: CompleteInput): Promise<CompletionResult> {
    const clientRequestId = input.requestId ?? randomUUID();
    if (!opaqueId(clientRequestId) || !modelId(input.model) || typeof input.provider !== 'string' || !input.provider.trim() || input.provider.length > 100 || /\r|\n/u.test(input.provider)) throw new OpenRouterError('INVALID_REQUEST', 'DEFINITIVE_REJECTION', 'The frozen model, provider or correlation identity is invalid.', { clientRequestId, dispatched: false });
    if (!Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens < 1 || input.maxOutputTokens > 2_000_000) throw new OpenRouterError('INVALID_OUTPUT_CAP', 'DEFINITIVE_REJECTION', 'An explicit positive output-token cap is required.', { clientRequestId, dispatched: false });
    if (!Array.isArray(input.messages) || !input.messages.length || input.messages.some(message => !message || !['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string')) throw new OpenRouterError('INVALID_MESSAGES', 'DEFINITIVE_REJECTION', 'The generation envelope must contain valid text-only messages.', { clientRequestId, dispatched: false });
    if (input.temperature !== undefined && (!Number.isFinite(input.temperature) || input.temperature < 0 || input.temperature > 2)) throw new OpenRouterError('INVALID_TEMPERATURE', 'DEFINITIVE_REJECTION', 'Invalid configured model temperature.', { clientRequestId, dispatched: false });
    if (input.jsonSchema !== undefined && !record(input.jsonSchema)) throw new OpenRouterError('INVALID_SCHEMA', 'DEFINITIVE_REJECTION', 'Structured output requires an object JSON Schema.', { clientRequestId, dispatched: false });
    const schemaName = input.schemaName ?? 'prompt_battle_output';
    if (!/^[a-zA-Z0-9_-]{1,64}$/u.test(schemaName)) throw new OpenRouterError('INVALID_SCHEMA_NAME', 'DEFINITIVE_REJECTION', 'Invalid structured-output schema name.', { clientRequestId, dispatched: false });
    const body = {
      model: input.model, messages: input.messages.map(message => ({ role: message.role, content: message.content })),
      max_tokens: input.maxOutputTokens, stream: false,
      provider: { order: [input.provider.trim()], allow_fallbacks: false, require_parameters: true, data_collection: 'deny' },
      ...(input.temperature !== undefined && !input.model.startsWith('anthropic/claude-sonnet-5.5') ? { temperature: input.temperature } : {}),
      ...(input.jsonSchema ? { response_format: { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema: input.jsonSchema } } } : {})
    };
    const raw = await this.request('/chat/completions', { method: 'POST', body, authenticated: true, clientRequestId });
    let usage: TokenUsage | undefined;
    try { usage = record(raw) ? normalizeCompletionUsage(raw.usage) : undefined; }
    catch { throw new OpenRouterError('INVALID_USAGE_RECEIPT', 'AMBIGUOUS', 'The provider usage receipt is inconsistent; preserve it for reconciliation.', { clientRequestId, generationId: generationId(raw), rawReceipt: raw, dispatched: true }); }
    const evidence = { clientRequestId, generationId: generationId(raw), rawReceipt: raw, usage, dispatched: true };
    if (!record(raw) || !opaqueId(raw.id)) throw new OpenRouterError('MISSING_GENERATION_ID', 'AMBIGUOUS', 'The response has no stable provider generation identity.', evidence);
    if (raw.model !== input.model) throw new OpenRouterError('MODEL_MISMATCH', 'AMBIGUOUS', 'The response model does not match the frozen requested model.', evidence);
    if (!Array.isArray(raw.choices) || !record(raw.choices[0]) || !record(raw.choices[0].message)) throw new OpenRouterError('MISSING_GENERATION_ANSWER', 'AMBIGUOUS', 'The provider returned no usable immutable answer.', evidence);
    const choice = raw.choices[0], message = choice.message as Record<string, unknown>;
    if (Array.isArray(message.tool_calls) && message.tool_calls.length) throw new OpenRouterError('UNSUPPORTED_TOOL_RESPONSE', 'AMBIGUOUS', 'Unexpected tool output is not a text-only competition answer.', evidence);
    if (typeof message.content !== 'string') throw new OpenRouterError('MISSING_GENERATION_ANSWER', 'AMBIGUOUS', 'The provider returned no text answer.', evidence);
    return { id: raw.id, model: raw.model as string, content: message.content, usage, rawReceipt: raw, clientRequestId,
      ...(typeof raw.provider === 'string' ? { provider: raw.provider } : {}), ...(typeof choice.finish_reason === 'string' ? { finishReason: choice.finish_reason } : {}) };
  }
  async recover(id: string, expectedModel?: string): Promise<RecoveryResult> {
    if (!opaqueId(id)) throw new OpenRouterError('INVALID_GENERATION_ID', 'AMBIGUOUS', 'A valid stored generation identity is required for usage recovery.');
    let raw: unknown;
    try { raw = await this.request(`/generation?id=${encodeURIComponent(id)}`, { method: 'GET', authenticated: true, clientRequestId: randomUUID() }); }
    catch (error) {
      if (error instanceof OpenRouterError) throw new OpenRouterError(error.code, 'AMBIGUOUS', error.message, {
        status: error.status, clientRequestId: error.clientRequestId, generationId: id,
        rawReceipt: error.rawReceipt, usage: error.usage, dispatched: error.dispatched
      });
      throw error;
    }
    const data = record(raw) && record(raw.data) ? raw.data : undefined;
    if (!data || data.id !== id || !modelId(data.model)) throw new OpenRouterError('RECOVERY_IDENTITY_MISMATCH', 'AMBIGUOUS', 'Recovered statistics do not identify the stored generation.', { generationId: id, rawReceipt: raw, dispatched: true });
    if (expectedModel && data.model !== expectedModel) throw new OpenRouterError('RECOVERY_MODEL_MISMATCH', 'AMBIGUOUS', 'Recovered statistics do not match the frozen generation model.', { generationId: id, rawReceipt: raw, dispatched: true });
    let usage: TokenUsage | undefined;
    try { usage = normalizeRecoveryUsage(data); }
    catch { throw new OpenRouterError('INVALID_RECOVERY_USAGE', 'AMBIGUOUS', 'Recovered usage is inconsistent; retain the original receipt for review.', { generationId: id, rawReceipt: raw, dispatched: true }); }
    return { id, model: data.model, usage, rawReceipt: raw, ...(typeof data.provider_name === 'string' ? { provider: data.provider_name } : {}) };
  }
  async getCatalog(): Promise<{ models: CatalogModel[]; rawReceipt: unknown }> {
    const raw = await this.request('/models', { method: 'GET', authenticated: false, clientRequestId: randomUUID() });
    if (!record(raw) || !Array.isArray(raw.data)) throw new OpenRouterError('INVALID_CATALOG', 'AMBIGUOUS', 'OpenRouter returned an invalid public model catalog.', { rawReceipt: raw, dispatched: true });
    const models = raw.data.map((entry: unknown): CatalogModel => {
      if (!record(entry) || !modelId(entry.id)) throw new OpenRouterError('INVALID_CATALOG_MODEL', 'AMBIGUOUS', 'The catalog contains an invalid model identity.', { dispatched: true });
      return { id: entry.id, name: typeof entry.name === 'string' ? entry.name : entry.id,
        supportedParameters: Array.isArray(entry.supported_parameters) ? entry.supported_parameters.filter((value): value is string => typeof value === 'string') : [],
        ...(safeToken(entry.context_length) ? { contextLength: entry.context_length } : {}),
        ...(record(entry.pricing) ? { pricing: Object.fromEntries(Object.entries(entry.pricing).filter(([, value]) => typeof value === 'string')) as Record<string, string> } : {}) };
    });
    return { models, rawReceipt: raw };
  }
  async listModels(): Promise<CatalogModel[]> { return (await this.getCatalog()).models; }
}