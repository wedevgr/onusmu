import { config } from '../config';
import { OpenAIEmbeddings } from './embeddings/openai';
import { OpenAILlm } from './llm/openai';
import { DeepgramTranscription } from './stt/deepgram';
import { WhisperTranscription } from './stt/whisper';
import type { EmbeddingProvider, LlmProvider, TranscriptionProvider } from './types';

let stt: TranscriptionProvider | null = null;
let embeddings: EmbeddingProvider | null = null;
let llm: LlmProvider | null = null;

export function getSttProvider(): TranscriptionProvider {
  if (!stt) {
    stt =
      config.STT_PROVIDER === 'deepgram'
        ? new DeepgramTranscription(config.DEEPGRAM_API_KEY)
        : new WhisperTranscription(config.OPENAI_API_KEY);
  }
  return stt;
}

export function getEmbeddingProvider(): EmbeddingProvider {
  if (!embeddings) embeddings = new OpenAIEmbeddings(config.OPENAI_API_KEY);
  return embeddings;
}

export function getLlmProvider(): LlmProvider {
  if (!llm) llm = new OpenAILlm(config.OPENAI_API_KEY);
  return llm;
}
