import { config } from '../../config';
import type { TranscriptionHints, TranscriptionProvider } from '../types';

// Lines Whisper-family models produce on silence or noise, learned from subtitle data.
// A chunk that is only one of these is treated as no speech.
const HALLUCINATIONS = [
  /^υπότιτλοι/i,
  /^ευχαριστώ (πολύ )?(που|για) (την )?(παρακολουθ|προσοχ)/i,
  /^thank(s| you) for watching/i,
  /^subtitles by/i,
  /^\.+$/,
];

export class WhisperTranscription implements TranscriptionProvider {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = 'https://api.openai.com/v1',
  ) {}

  async transcribe(audio: Buffer, filename: string, hints?: TranscriptionHints): Promise<string> {
    const form = new FormData();
    form.append('file', new Blob([toArrayBuffer(audio)], { type: 'audio/m4a' }), filename);
    form.append('model', config.STT_MODEL);
    form.append('response_format', 'json');
    if (config.STT_LANGUAGE) form.append('language', config.STT_LANGUAGE);
    if (hints?.prompt) form.append('prompt', hints.prompt);

    const res = await fetch(`${this.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    if (!res.ok) {
      throw new Error(`Transcription failed: ${res.status} ${(await res.text()).slice(0, 500)}`);
    }
    const data = (await res.json()) as { text?: string };
    const text = (data.text ?? '').trim();
    if (HALLUCINATIONS.some((re) => re.test(text)) && text.length < 80) return '';
    // Forced to Greek, a short line with no Greek letter is the model guessing at noise.
    if (config.STT_LANGUAGE === 'el' && !GREEK_LETTER.test(text) && text.length < 80) return '';
    return text;
  }
}

const GREEK_LETTER = /[Ͱ-Ͽἀ-῿]/;

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}
