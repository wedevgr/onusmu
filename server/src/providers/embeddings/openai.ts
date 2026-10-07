import OpenAI from 'openai';
import { config } from '../../config';
import type { EmbeddingProvider } from '../types';

export class OpenAIEmbeddings implements EmbeddingProvider {
  private readonly client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async embed(texts: string[]): Promise<number[][]> {
    const res = await this.client.embeddings.create({
      model: config.EMBEDDING_MODEL,
      input: texts,
    });
    return res.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding as number[]);
  }
}
