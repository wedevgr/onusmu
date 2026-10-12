import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().default(8787),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url(),

  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  STT_PROVIDER: z.enum(['whisper', 'deepgram']).default('whisper'),
  OPENAI_API_KEY: z.string().default(''),
  DEEPGRAM_API_KEY: z.string().default(''),

  EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  EMBEDDING_DIM: z.coerce.number().int().default(1536),
  LLM_MODEL: z.string().default('gpt-4o-mini'),

  MAX_UPLOAD_MB: z.coerce.number().int().default(25),
  JOB_POLL_MS: z.coerce.number().int().default(2000),

  BILLING_TIMEZONE: z.string().default('Europe/Athens'),
});

export type Config = z.infer<typeof envSchema>;

export const config: Config = envSchema.parse(process.env);

export const AUDIO_BUCKET = 'audio-chunks';
