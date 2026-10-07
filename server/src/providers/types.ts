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
  chat(messages: ChatMessage[], opts?: { temperature?: number }): Promise<string>;
}
