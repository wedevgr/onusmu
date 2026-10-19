import { config } from '../config';
import { query, queryOne } from '../db';
import { AppError } from './errors';

export type PlanId = 'free' | 'starter' | 'plus' | 'pro' | 'unlimited';
export type PaidPlanId = Exclude<PlanId, 'free'>;
export type UsagePeriod = 'day' | 'month';

interface Plan {
  period: UsagePeriod;
  limitSeconds: number | null; // null = no limit
  // Chat questions per day. Each costs a few model calls, so even "unlimited" has a ceiling
  // that only a bug or abuse would reach.
  chatPerDay: number;
}

// Recording allowances. Prices (€3 / €5 / €10 / €20 a month) live in Stripe, not here.
export const PLANS: Record<PlanId, Plan> = {
  free: { period: 'day', limitSeconds: 5 * 60, chatPerDay: 20 },
  starter: { period: 'day', limitSeconds: 30 * 60, chatPerDay: 60 },
  plus: { period: 'day', limitSeconds: 5 * 60 * 60, chatPerDay: 200 },
  pro: { period: 'day', limitSeconds: 10 * 60 * 60, chatPerDay: 400 },
  unlimited: { period: 'month', limitSeconds: null, chatPerDay: 1000 },
};

/** Throws 429 when the user has asked their plan's questions for today (billing-timezone day). */
export async function assertChatAllowance(userId: string): Promise<void> {
  const { plan } = await getActivePlan(userId);
  const limit = PLANS[plan].chatPerDay;
  const row = await queryOne<{ asked: number }>(
    `SELECT count(*)::int AS asked FROM chat_messages
     WHERE user_id = $1 AND role = 'user'
       AND created_at >= (date_trunc('day', now() AT TIME ZONE $2::text) AT TIME ZONE $2::text)`,
    [userId, config.BILLING_TIMEZONE],
  );
  if ((row?.asked ?? 0) >= limit) {
    throw new AppError(
      429,
      `Έφτασες τις ${limit} ερωτήσεις για σήμερα. Το όριο ανανεώνεται τα μεσάνυχτα` +
        (plan === 'unlimited' ? '.' : ' ή με ένα μεγαλύτερο πλάνο.'),
    );
  }
}

export interface BillingStatus {
  plan: PlanId;
  // Where the paid plan was bought ('stripe', 'app_store', ...); null on the free plan.
  provider: string | null;
  period: UsagePeriod;
  limitSeconds: number | null;
  usedSeconds: number;
  remainingSeconds: number | null;
  periodStart: Date;
  resetsAt: Date;
}

const BACKDATE_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * The instant a chunk is billed at. Recordings uploaded late (offline) count against the
 * day they were made, but only within a short window: anything older, or in the future,
 * counts against today so a client cannot backdate chunks into unused days.
 */
export function usageInstant(startedAt: Date, now: Date = new Date()): Date {
  const age = now.getTime() - startedAt.getTime();
  return age < 0 || age > BACKDATE_WINDOW_MS ? now : startedAt;
}

async function getActivePlan(userId: string): Promise<{ plan: PlanId; provider: string | null }> {
  const row = await queryOne<{ plan: string; provider: string }>(
    `SELECT plan, provider FROM subscriptions
     WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > now())`,
    [userId],
  );
  return row && row.plan in PLANS
    ? { plan: row.plan as PlanId, provider: row.provider }
    : { plan: 'free', provider: null };
}

export async function getBillingStatus(userId: string, at: Date = new Date()): Promise<BillingStatus> {
  const { plan: planId, provider } = await getActivePlan(userId);
  const plan = PLANS[planId];
  // Period bounds are computed in the billing timezone so "a day" resets at local midnight.
  const row = await queryOne<{ used: number; periodStart: Date; resetsAt: Date }>(
    `WITH bounds AS (
       SELECT date_trunc($3::text, $2::timestamptz AT TIME ZONE $4::text) AS start_local,
              date_trunc($3::text, $2::timestamptz AT TIME ZONE $4::text)
                + ('1 ' || $3::text)::interval AS end_local
     )
     SELECT COALESCE((
              SELECT SUM(u.seconds) FROM recording_usage u
              WHERE u.user_id = $1 AND u.day >= b.start_local::date AND u.day < b.end_local::date
            ), 0)::int AS used,
            b.start_local AT TIME ZONE $4::text AS "periodStart",
            b.end_local AT TIME ZONE $4::text   AS "resetsAt"
     FROM bounds b`,
    [userId, at.toISOString(), plan.period, config.BILLING_TIMEZONE],
  );
  if (!row) throw new Error('Failed to compute usage');
  return {
    plan: planId,
    provider,
    period: plan.period,
    limitSeconds: plan.limitSeconds,
    usedSeconds: row.used,
    remainingSeconds: plan.limitSeconds === null ? null : Math.max(0, plan.limitSeconds - row.used),
    periodStart: row.periodStart,
    resetsAt: row.resetsAt,
  };
}

/**
 * Throws 402 once the allowance for the period containing `at` is used up. A chunk that
 * starts under the limit is accepted whole, so the last segment of a recording is never lost.
 */
export async function assertWithinQuota(userId: string, at: Date): Promise<void> {
  const status = await getBillingStatus(userId, at);
  if (status.remainingSeconds !== null && status.remainingSeconds <= 0) {
    throw new AppError(402, 'Recording limit reached for your plan');
  }
}

export async function recordUsage(userId: string, at: Date, seconds: number): Promise<void> {
  await query(
    `INSERT INTO recording_usage (user_id, day, seconds)
     VALUES ($1, ($2::timestamptz AT TIME ZONE $4::text)::date, $3)
     ON CONFLICT (user_id, day) DO UPDATE SET
       seconds = recording_usage.seconds + EXCLUDED.seconds`,
    [userId, at.toISOString(), seconds, config.BILLING_TIMEZONE],
  );
}
