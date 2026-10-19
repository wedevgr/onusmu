import OpenAI from 'openai';
import { config } from '../../config';
import type { ChatMessage, LlmProvider } from '../types';

export class OpenAILlm implements LlmProvider {
  private readonly client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async chat(
    messages: ChatMessage[],
    opts?: { temperature?: number; json?: boolean; model?: string },
  ): Promise<string> {
    const res = await this.client.chat.completions.create({
      model: opts?.model || config.LLM_MODEL,
      messages,
      temperature: opts?.temperature ?? 0.2,
      ...(opts?.json ? { response_format: { type: 'json_object' as const } } : {}),
    });
    const content = res.choices[0]?.message?.content;
    if (!content) throw new Error('LLM returned empty response');
    return content.trim();
  }

  async chatStream(
    messages: ChatMessage[],
    onDelta: (text: string) => void,
    opts?: { temperature?: number; model?: string },
  ): Promise<string> {
    const stream = await this.client.chat.completions.create({
      model: opts?.model || config.LLM_MODEL,
      messages,
      temperature: opts?.temperature ?? 0.2,
      stream: true,
    });
    let text = '';
    for await (const part of stream) {
      const delta = part.choices[0]?.delta?.content ?? '';
      if (delta) {
        text += delta;
        onDelta(delta);
      }
    }
    if (!text) throw new Error('LLM returned empty response');
    return text.trim();
  }
}
