import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OpenRouterClient, OpenRouterError, GENERATOR_MODEL_ID, REVIEWER_MODEL_ID,
  normalizeCompletionUsage, normalizeRecoveryUsage, classifyHttpFailure,
  type CompleteInput
} from '../src';

const input: CompleteInput = { model: GENERATOR_MODEL_ID, provider: 'DeepSeek', messages: [{ role: 'system', content: 'Return the requested answer.' }, { role: 'user', content: 'My manually written prompt.' }], maxOutputTokens: 8192, temperature: 0 };
function receipt(overrides: Record<string, unknown> = {}) {
  return { id: 'gen-stable-123', model: GENERATOR_MODEL_ID, provider: 'DeepSeek', choices: [{ message: { role: 'assistant', content: '{"allocations":[],"rationale":"example"}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, cost: 0.001 }, ...overrides };
}
function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>): typeof globalThis.fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => handler(String(url), init ?? {})) as typeof globalThis.fetch;
}
function json(value: unknown, status = 200): Response { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }); }

test('completion pins provider, denies fallback/data collection and keeps credentials server-side', async () => {
  let captured: RequestInit | undefined;
  const client = new OpenRouterClient({ apiKey: 'server-test-key', fetchImpl: fakeFetch((_url, init) => { captured = init; return json(receipt()); }) });
  const result = await client.complete({ ...input, requestId: 'audit-correlation-1' });
  const body = JSON.parse(captured!.body as string);
  assert.deepEqual(body.provider, { order: ['DeepSeek'], allow_fallbacks: false, require_parameters: true, data_collection: 'deny' });
  assert.equal(body.max_tokens, 8192); assert.equal(body.stream, false);
  assert.equal((captured!.headers as Record<string, string>).Authorization, 'Bearer server-test-key');
  assert.equal(result.id, 'gen-stable-123'); assert.equal(result.clientRequestId, 'audit-correlation-1');
  assert.equal(result.usage!.totalTokens, 150);
  assert.equal((captured!.headers as Record<string, string>)['Idempotency-Key'], undefined);
  assert.ok(!JSON.stringify(result.rawReceipt).includes('server-test-key'));
});

test('Claude Sonnet 5.5 requests omit unsupported temperature and use strict raw schema', async () => {
  let body: any;
  const client = new OpenRouterClient({ apiKey: 'server-test-key', fetchImpl: fakeFetch((_url, init) => { body = JSON.parse(init.body as string); return json(receipt({ model: REVIEWER_MODEL_ID })); }) });
  await client.complete({ ...input, model: REVIEWER_MODEL_ID, provider: 'Anthropic', temperature: 0, jsonSchema: { type: 'object', properties: {} } });
  assert.equal(body.temperature, undefined); assert.equal(body.response_format.type, 'json_schema'); assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.provider.allow_fallbacks, false);
});

test('missing and partial usage remain unknown rather than fabricated zero', async () => {
  const client = new OpenRouterClient({ apiKey: 'key', fetchImpl: fakeFetch(() => json(receipt({ usage: undefined }))) });
  assert.equal((await client.complete(input)).usage, undefined);
  assert.equal(normalizeCompletionUsage({ prompt_tokens: 100 }), undefined);
  assert.equal(normalizeCompletionUsage(null), undefined);
});

test('cached and reasoning subsets do not double-count participant usage', () => {
  const usage = normalizeCompletionUsage({ prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, cost: 0, prompt_tokens_details: { cached_tokens: 40 }, completion_tokens_details: { reasoning_tokens: 25 } });
  assert.deepEqual(usage, { inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0, cachedInputTokens: 40, reasoningTokens: 25 });
  assert.throws(() => normalizeCompletionUsage({ prompt_tokens: 10, completion_tokens: 10, completion_tokens_details: { reasoning_tokens: 11 } }));
});

test('inconsistent usage yields pending classification and retains original provider receipt', async () => {
  const raw = receipt({ usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 1 } });
  const client = new OpenRouterClient({ apiKey: 'key', fetchImpl: fakeFetch(() => json(raw)) });
  await assert.rejects(client.complete(input), (error: unknown) => {
    assert.ok(error instanceof OpenRouterError); assert.equal(error.code, 'INVALID_USAGE_RECEIPT'); assert.equal(error.kind, 'AMBIGUOUS');
    assert.equal(error.generationId, 'gen-stable-123'); assert.deepEqual(error.rawReceipt, raw); return true;
  });
});

test('unexpected model cannot silently become a valid competition generation', async () => {
  const client = new OpenRouterClient({ apiKey: 'key', fetchImpl: fakeFetch(() => json(receipt({ model: 'another/model' }))) });
  await assert.rejects(client.complete(input), (error: unknown) => {
    assert.ok(error instanceof OpenRouterError); assert.equal(error.code, 'MODEL_MISMATCH'); assert.equal(error.kind, 'AMBIGUOUS');
    assert.equal(error.usage!.totalTokens, 150); return true;
  });
});

test('missing answer and unexpected tool output retain chargeable usage evidence', async () => {
  const client = new OpenRouterClient({ apiKey: 'key', fetchImpl: fakeFetch(() => json(receipt({ choices: [{ message: { content: null, tool_calls: [{ id: 'tool' }] } }] }))) });
  await assert.rejects(client.complete(input), (error: unknown) => { assert.ok(error instanceof OpenRouterError); assert.equal(error.code, 'UNSUPPORTED_TOOL_RESPONSE'); assert.equal(error.usage!.totalTokens, 150); return true; });
});

test('recognizable gateway authentication rejection is definitive without retries or header leakage', async () => {
  let calls = 0;
  const client = new OpenRouterClient({ apiKey: 'sensitive-secret', fetchImpl: fakeFetch(() => { calls++; return json({ error: { code: 401, message: 'Invalid key' } }, 401); }) });
  await assert.rejects(client.complete(input), (error: unknown) => { assert.ok(error instanceof OpenRouterError); assert.equal(error.kind, 'DEFINITIVE_REJECTION'); assert.ok(!error.message.includes('sensitive-secret')); return true; });
  assert.equal(calls, 1);
});

test('upstream errors, execution evidence and server errors are conservatively ambiguous', () => {
  assert.equal(classifyHttpFailure(400, { error: { code: 400, metadata: { provider_name: 'DeepSeek' } } }), 'AMBIGUOUS');
  assert.equal(classifyHttpFailure(429, { id: 'gen-processed', error: { code: 429 } }), 'AMBIGUOUS');
  assert.equal(classifyHttpFailure(503, { error: { code: 503 } }), 'AMBIGUOUS');
  assert.equal(classifyHttpFailure(401, { error: { code: 401 } }), 'DEFINITIVE_REJECTION');
});

test('network failure is unknown and never retried automatically', async () => {
  let calls = 0;
  const client = new OpenRouterClient({ apiKey: 'key', fetchImpl: fakeFetch(() => { calls++; throw new Error('transport stopped'); }) });
  await assert.rejects(client.complete(input), (error: unknown) => { assert.ok(error instanceof OpenRouterError); assert.equal(error.code, 'NETWORK_OUTCOME_UNKNOWN'); assert.equal(error.kind, 'AMBIGUOUS'); return true; });
  assert.equal(calls, 1);
});

test('timeout is typed pending even when transport ignores cancellation', async () => {
  let calls = 0;
  const client = new OpenRouterClient({ apiKey: 'key', timeoutMs: 5, fetchImpl: fakeFetch(() => { calls++; return new Promise<Response>(() => {}); }) });
  await assert.rejects(client.complete(input), (error: unknown) => { assert.ok(error instanceof OpenRouterError); assert.equal(error.code, 'REQUEST_TIMEOUT'); assert.equal(error.kind, 'AMBIGUOUS'); assert.equal(error.dispatched, true); return true; });
  assert.equal(calls, 1);
});

test('deadline also covers a stalled receipt body', async () => {
  const stalled = { ok: true, status: 200, json: () => new Promise<unknown>(() => {}) } as Response;
  const client = new OpenRouterClient({ apiKey: 'key', timeoutMs: 5, fetchImpl: fakeFetch(() => stalled) });
  await assert.rejects(client.complete(input), (error: unknown) => { assert.ok(error instanceof OpenRouterError); assert.equal(error.code, 'REQUEST_TIMEOUT'); return true; });
});

test('recovery binds stored identity/model and uses native provider counts without returning answer text', async () => {
  let url = '';
  const raw = { data: { id: 'gen-stable-123', model: GENERATOR_MODEL_ID, provider_name: 'DeepSeek', native_tokens_prompt: 100, native_tokens_completion: 50, native_tokens_reasoning: 25, total_cost: 0.001 } };
  const client = new OpenRouterClient({ apiKey: 'key', fetchImpl: fakeFetch((value, init) => { url = value; assert.equal(init.method, 'GET'); return json(raw); }) });
  const result = await client.recover('gen-stable-123', GENERATOR_MODEL_ID);
  assert.ok(url.endsWith('/generation?id=gen-stable-123')); assert.equal(result.usage!.totalTokens, 150); assert.equal((result as any).content, undefined); assert.deepEqual(result.rawReceipt, raw);
});

test('normalized statistics alone do not masquerade as native participant usage', () => {
  assert.equal(normalizeRecoveryUsage({ tokens_prompt: 200, tokens_completion: 100, total_cost: 0.001 }), undefined);
});

test('recovery ID/model mismatch remains an unresolved original generation', async () => {
  const client = new OpenRouterClient({ apiKey: 'key', fetchImpl: fakeFetch(() => json({ data: { id: 'gen-other', model: GENERATOR_MODEL_ID, native_tokens_prompt: 1, native_tokens_completion: 2 } })) });
  await assert.rejects(client.recover('gen-stable-123', GENERATOR_MODEL_ID), (error: unknown) => { assert.ok(error instanceof OpenRouterError); assert.equal(error.code, 'RECOVERY_IDENTITY_MISMATCH'); assert.equal(error.kind, 'AMBIGUOUS'); return true; });
});

test('failed recovery never authorizes release of the original generation reservation', async () => {
  const client = new OpenRouterClient({ apiKey: 'key', fetchImpl: fakeFetch(() => json({ error: { code: 404 } }, 404)) });
  await assert.rejects(client.recover('gen-stable-123'), (error: unknown) => { assert.ok(error instanceof OpenRouterError); assert.equal(error.kind, 'AMBIGUOUS'); assert.equal(error.generationId, 'gen-stable-123'); return true; });
});

test('public catalog can be read without sending API credentials', async () => {
  const client = new OpenRouterClient({ fetchImpl: fakeFetch((_url, init) => {
    assert.equal((init.headers as Record<string, string>).Authorization, undefined);
    return json({ data: [{ id: GENERATOR_MODEL_ID, name: 'DeepSeek', context_length: 128000, supported_parameters: ['temperature'], pricing: { prompt: '0.000001', completion: '0.000002' } }] });
  }) });
  const models = await client.listModels(); assert.equal(models[0].id, GENERATOR_MODEL_ID); assert.equal(models[0].contextLength, 128000);
});

test('missing server key and invalid caps fail locally without making a provider call', async () => {
  let calls = 0;
  const fetchImpl = fakeFetch(() => { calls++; return json(receipt()); });
  await assert.rejects(new OpenRouterClient({ fetchImpl }).complete(input), (error: unknown) => { assert.ok(error instanceof OpenRouterError); assert.equal(error.code, 'MISSING_API_KEY'); assert.equal(error.dispatched, false); return true; });
  await assert.rejects(new OpenRouterClient({ apiKey: 'key', fetchImpl }).complete({ ...input, maxOutputTokens: 0 }));
  assert.equal(calls, 0);
});

test('malformed successful HTTP receipt is ambiguous rather than zero usage', async () => {
  const client = new OpenRouterClient({ apiKey: 'key', fetchImpl: fakeFetch(() => new Response('not-json', { status: 200 })) });
  await assert.rejects(client.complete(input), (error: unknown) => { assert.ok(error instanceof OpenRouterError); assert.equal(error.code, 'INVALID_HTTP_RECEIPT'); assert.equal(error.kind, 'AMBIGUOUS'); return true; });
});