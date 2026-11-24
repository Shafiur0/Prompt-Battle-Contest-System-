import { SAMPLE_OPTIMAL_ANSWER } from '@prompt-battle/core';
import { config } from '../config';

export interface GenerationResult {
  body: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  providerRequestId: string | null;
  rawUsage: unknown;
  modelRevision: string;
  mode: 'provider' | 'mock';
}

export class ProviderRejected extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export class ProviderAmbiguous extends Error {
  constructor(message: string) {
    super(message);
  }
}

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

/**
 * Single place that talks to the hosted provider. Every call is bounded by
 * `maxTokens`, and the returned usage is what the ledger settles against.
 */
export async function chatCompletion(options: {
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature?: number;
  providerOrder?: string;
}): Promise<{
  content: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  providerRequestId: string | null;
  rawUsage: unknown;
  modelRevision: string;
}> {
  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
    max_tokens: options.maxTokens,
    temperature: options.temperature ?? 0,
    usage: { include: true }
  };
  if (options.providerOrder) body.provider = { order: [options.providerOrder], allow_fallbacks: false };

  let response: Response;
  try {
    response = await fetch(`${config.generation.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.generation.apiKey}`,
        'HTTP-Referer': config.appOrigin,
        'X-Title': 'Prompt Battle'
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000)
    });
  } catch (error) {
    // The request may or may not have reached the provider.
    throw new ProviderAmbiguous(
      `Transport failure before a terminal response: ${error instanceof Error ? error.message : 'unknown'}`
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    if (response.status >= 400 && response.status < 500) {
      throw new ProviderRejected(`Provider rejected the request (${response.status}): ${text.slice(0, 300)}`, response.status);
    }
    throw new ProviderAmbiguous(`Provider error ${response.status}: ${text.slice(0, 300)}`);
  }

  const payload = (await response.json()) as {
    id?: string;
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number };
      completion_tokens_details?: { reasoning_tokens?: number };
    };
  };

  const content = payload.choices?.[0]?.message?.content ?? '';
  const usage = payload.usage ?? {};
  const inputTokens = Number(usage.prompt_tokens ?? 0);
  const outputTokens = Number(usage.completion_tokens ?? 0);
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) {
    throw new ProviderAmbiguous('Provider response carried no usable usage block');
  }

  return {
    content,
    inputTokens,
    outputTokens,
    cachedInputTokens: Number(usage.prompt_tokens_details?.cached_tokens ?? 0),
    reasoningTokens: Number(usage.completion_tokens_details?.reasoning_tokens ?? 0),
    providerRequestId: payload.id ?? null,
    rawUsage: usage,
    modelRevision: options.model
  };
}

/**
 * Deterministic offline provider.
 *
 * Used only when no provider key is configured, so the platform can be
 * exercised end to end. It reports plausible usage that is always below the
 * reservation bound. It is never presented as a real model result.
 */
export function mockGeneration(envelope: string, maxTokens: number): GenerationResult {
  const body = JSON.stringify(SAMPLE_OPTIMAL_ANSWER, null, 2);
  const inputTokens = Math.max(1, Math.ceil(Buffer.byteLength(envelope, 'utf8') / 4));
  const outputTokens = Math.min(maxTokens, Math.max(1, Math.ceil(Buffer.byteLength(body, 'utf8') / 4)));
  return {
    body,
    inputTokens,
    outputTokens,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    providerRequestId: `mock-${Date.now()}`,
    rawUsage: {
      mock: true,
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens
    },
    modelRevision: 'mock-deterministic-v1',
    mode: 'mock'
  };
}

export function providerIsConfigured(): boolean {
  return config.generation.apiKey.trim().length > 0;
}

export async function generate(envelope: string, maxTokens: number): Promise<GenerationResult> {
  if (!providerIsConfigured()) {
    if (!config.generation.mockWhenUnconfigured) {
      throw new ProviderAmbiguous('No provider key is configured');
    }
    return mockGeneration(envelope, maxTokens);
  }
  const result = await chatCompletion({
    model: config.generation.model,
    messages: [
      {
        role: 'system',
        content:
          'You are the fixed generation model for a competition. Follow the participant instructions exactly. ' +
          'Return only the requested output.'
      },
      { role: 'user', content: envelope }
    ],
    maxTokens,
    temperature: 0,
    providerOrder: config.generation.provider || undefined
  });
  return { ...result, mode: 'provider' };
}
