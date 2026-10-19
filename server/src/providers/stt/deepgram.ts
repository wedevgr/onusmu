import { config } from '../../config';
import type { TranscriptionHints, TranscriptionProvider } from '../types';

// Deepgram caps keyword boosting; the most mentioned names come first.
const MAX_KEYWORDS = 50;

export class DeepgramTranscription implements TranscriptionProvider {
  constructor(private readonly apiKey: string) {}

  async transcribe(audio: Buffer, _filename: string, hints?: TranscriptionHints): Promise<string> {
    const params = new URLSearchParams({ model: 'nova-2', punctuate: 'true', smart_format: 'true' });
    if (config.STT_LANGUAGE) params.set('language', config.STT_LANGUAGE);
    for (const term of (hints?.terms ?? []).slice(0, MAX_KEYWORDS)) params.append('keywords', `${term}:2`);

    const res = await fetch(`https://api.deepgram.com/v1/listen?${params.toString()}`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${this.apiKey}`,
        'Content-Type': 'audio/m4a',
      },
      body: audio,
    });
    if (!res.ok) {
      throw new Error(`Deepgram STT failed: ${res.status} ${(await res.text()).slice(0, 500)}`);
    }
    const data = (await res.json()) as {
      results?: { channels?: { alternatives?: { transcript?: string }[] }[] };
    };
    const transcript = data.results?.channels?.[0]?.alternatives?.[0]?.transcript;
    return (transcript ?? '').trim();
  }
}
