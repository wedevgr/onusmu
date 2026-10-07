import type { TranscriptionProvider } from '../types';

export class WhisperTranscription implements TranscriptionProvider {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = 'https://api.openai.com/v1',
  ) {}

  async transcribe(audio: Buffer, filename: string): Promise<string> {
    const form = new FormData();
    form.append('file', new Blob([toArrayBuffer(audio)], { type: 'audio/m4a' }), filename);
    form.append('model', 'whisper-1');
    form.append('response_format', 'json');

    const res = await fetch(`${this.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    if (!res.ok) {
      throw new Error(`Whisper STT failed: ${res.status} ${(await res.text()).slice(0, 500)}`);
    }
    const data = (await res.json()) as { text?: string };
    return (data.text ?? '').trim();
  }
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}
