import type { TranscriptionProvider } from '../types';

export class DeepgramTranscription implements TranscriptionProvider {
  constructor(private readonly apiKey: string) {}

  async transcribe(audio: Buffer): Promise<string> {
    const url = 'https://api.deepgram.com/v1/listen?model=nova-2&punctuate=true';
    const res = await fetch(url, {
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
