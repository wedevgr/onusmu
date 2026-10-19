export interface TranscriptionHints {
  /** Text that steers spelling and continuity: known names and the end of the previous chunk. */
  prompt?: string;
  /** Names to favour, for providers that take a word list. */
  terms?: string[];
}

export interface TranscriptionProvider {
  transcribe(audio: Buffer, filename: string, hints?: TranscriptionHints): Promise<string>;
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
  /** model overrides the configured LLM_MODEL for this call. */
  chat(messages: ChatMessage[], opts?: { temperature?: number; json?: boolean; model?: string }): Promise<string>;
  /** Like chat, calling onDelta with each piece of text as it is generated; resolves to the whole text. */
  chatStream(
    messages: ChatMessage[],
    onDelta: (text: string) => void,
    opts?: { temperature?: number; model?: string },
  ): Promise<string>;
}
