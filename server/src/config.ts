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
  // OpenAI transcription model ("whisper" provider). gpt-4o-transcribe is far better on Greek than whisper-1.
  STT_MODEL: z.string().default('gpt-4o-transcribe'),
  // ISO-639-1 language to force. Greek by default: auto-detection turns silence and noise into
  // invented English ("David Cooper", "I spam") and misreads Greek. "auto" detects per chunk.
  STT_LANGUAGE: z
    .string()
    .default('el')
    .transform((v) => (v.trim() === '' ? 'el' : v.trim() === 'auto' ? '' : v.trim())),
  OPENAI_API_KEY: z.string().default(''),
  DEEPGRAM_API_KEY: z.string().default(''),

  EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  EMBEDDING_DIM: z.coerce.number().int().default(1536),
  LLM_MODEL: z.string().default('gpt-4o-mini'),
  // Model that reads each recording for tasks, money and readings; empty uses LLM_MODEL.
  // gpt-4.1-mini was clearly more consistent than gpt-4o-mini on real notes (debts, dates, sales).
  // A stronger model here makes amounts and "who owes whom" more reliable.
  EXTRACT_MODEL: z.string().default('gpt-4.1-mini'),

  MAX_UPLOAD_MB: z.coerce.number().int().default(25),
  JOB_POLL_MS: z.coerce.number().int().default(2000),

  BILLING_TIMEZONE: z.string().default('Europe/Athens'),

  // Stripe (website subscriptions). Leave empty to run without payments.
  STRIPE_SECRET_KEY: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
  // Monthly price of each Onusmu plan product (€3 / €5 / €10 / €20); not secret.
  STRIPE_PRICE_STARTER: z.string().default('price_1UQYDbPYhfQFkR1Ff4dcgcdo'),
  STRIPE_PRICE_PLUS: z.string().default('price_1UQYg4PYhfQFkR1FYcI3CwqW'),
  STRIPE_PRICE_PRO: z.string().default('price_1UQYeyPYhfQFkR1FocuSFo56'),
  STRIPE_PRICE_UNLIMITED: z.string().default('price_1UQYfLPYhfQFkR1Fxbgj9784'),
  // Where Stripe sends people back to after checkout and the billing portal.
  WEBSITE_URL: z.string().default('http://localhost:3000'),

  // reCAPTCHA secret for website sign-up (/v1/auth/signup). Empty turns that route off.
  RECAPTCHA_SECRET_KEY: z.string().default(''),
});

export type Config = z.infer<typeof envSchema>;

export const config: Config = envSchema.parse(process.env);

export const AUDIO_BUCKET = 'audio-chunks';
