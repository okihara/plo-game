/**
 * Anthropic Messages API ラッパ。
 * 既存 callEvalLlm.ts (OpenAI) と同じく fetch を直叩きする最小限の実装。
 */
import { env } from '../../config/env.js';

const ANTHROPIC_VERSION = '2023-06-01';

export interface CallAnthropicInput {
  system: string;
  user: string;
  maxTokens?: number;
  model?: string;
}

export interface CallAnthropicResult {
  text: string;
  model: string;
}

export async function callAnthropic(input: CallAnthropicInput): Promise<CallAnthropicResult> {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey?.trim()) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }

  const model = input.model ?? env.ANTHROPIC_MODEL;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: input.maxTokens ?? 800,
      system: input.system,
      messages: [{ role: 'user', content: input.user }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${errText.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    model?: string;
  };
  const block = data.content?.find((c) => c.type === 'text');
  const text = block?.text?.trim();
  if (!text) {
    throw new Error('Anthropic returned empty content');
  }

  return { text, model: data.model ?? model };
}
