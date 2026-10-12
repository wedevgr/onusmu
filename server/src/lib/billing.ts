import { config } from '../config';
import { query, queryOne } from '../db';
import { AppError } from './errors';

export type PlanId = 'free' | 'plus' | 'unlimited';
export type UsagePeriod = 'day' | 'month';

interface Plan {
  period: UsagePeriod;
  limitSeconds: number | null; // null = no limit
}

// Recording allowances. Prices live in the stores / payment provider, not here.
export const PLANS: Record<PlanId, Plan> = {
  free: { period: 'day', limitSeconds: 10 * 60 },
  plus: { period: 'day', limitSeconds: 10 * 60 * 60 },
  unlimited: { period: 'month', limitSeconds: null },
};

export interface BillingStatus {
  plan: PlanId;
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

async function getPlanId(userId: string): Promise<PlanId> {
  const row = await queryOne<{ plan: string }>(
    `SELECT plan FROM subscriptions
     WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > now())`,
    [userId],
  );
  return row && row.plan in PLANS ? (row.plan as PlanId) : 'free';
}

export async function getBillingStatus(userId: string, at: Date = new Date()): Promise<BillingStatus> {
  const planId = await getPlanId(userId);
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
