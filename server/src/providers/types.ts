export interface TranscriptionProvider {
  transcribe(audio: Buffer, filename: string): Promise<string>;
}

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmProvider {
  /** json: the reply must be a single JSON object. */
  chat(messages: ChatMessage[], opts?: { temperature?: number; json?: boolean }): Promise<string>;
}
