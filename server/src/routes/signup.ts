import type { FastifyInstance } from 'fastify';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { config } from '../config';
import { AppError } from '../lib/errors';

const signupSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(6),
  captchaToken: z.string().min(1),
  // Where the confirmation link lands; Supabase only accepts its allowed Redirect URLs.
  redirectTo: z.string().url().optional(),
});

// reCAPTCHA v3 answers with a score (1.0 human, 0.0 bot); v2 has none.
const MIN_SCORE = 0.5;

async function verifyCaptcha(token: string): Promise<boolean> {
  const res = await fetch('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret: config.RECAPTCHA_SECRET_KEY, response: token }),
  });
  if (!res.ok) throw new AppError(502, 'Could not check the CAPTCHA, please try again');
  const data = (await res.json()) as { success?: boolean; score?: number };
  if (!data.success) return false;
  return typeof data.score !== 'number' || data.score >= MIN_SCORE;
}

/**
 * Website sign-up behind reCAPTCHA (Supabase's own CAPTCHA does not support reCAPTCHA).
 * The account is created with Supabase's normal sign-up, so the confirmation email is sent
 * as before. The app still signs up with Supabase directly.
 */
export default async function signupRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/signup', async (request) => {
    if (!config.RECAPTCHA_SECRET_KEY) throw new AppError(503, 'Sign-up is not configured');
    const { email, password, captchaToken, redirectTo } = signupSchema.parse(request.body);
    if (!(await verifyCaptcha(captchaToken))) {
      throw new AppError(400, 'CAPTCHA check failed, please try again');
    }

    // A client per request: sign-up keeps the new session in the client, which must not be shared.
    const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: redirectTo ? { emailRedirectTo: redirectTo } : undefined,
    });
    if (error) throw new AppError(error.status ?? 400, error.message);

    // With email confirmation off, the account is signed in right away.
    return {
      session: data.session
        ? { access_token: data.session.access_token, refresh_token: data.session.refresh_token }
        : null,
    };
  });
}
