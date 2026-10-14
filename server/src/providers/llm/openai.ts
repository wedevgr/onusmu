import OpenAI from 'openai';
import { config } from '../../config';
import type { ChatMessage, LlmProvider } from '../types';

export class OpenAILlm implements LlmProvider {
  private readonly client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async chat(messages: ChatMessage[], opts?: { temperature?: number; json?: boolean }): Promise<string> {
    const res = await this.client.chat.completions.create({
      model: config.LLM_MODEL,
      messages,
      temperature: opts?.temperature ?? 0.2,
      ...(opts?.json ? { response_format: { type: 'json_object' as const } } : {}),
    });
    const content = res.choices[0]?.message?.content;
    if (!content) throw new Error('LLM returned empty response');
    return content.trim();
  }
}
