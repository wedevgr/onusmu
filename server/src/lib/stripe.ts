import Stripe from 'stripe';
import { config } from '../config';
import { query, queryOne } from '../db';
import type { PaidPlanId } from './billing';
import { AppError } from './errors';

let client: Stripe | null = null;

export function isStripeConfigured(): boolean {
  return config.STRIPE_SECRET_KEY.length > 0;
}

export function getStripe(): Stripe {
  if (!isStripeConfigured()) throw new AppError(503, 'Payments are not configured');
  client ??= new Stripe(config.STRIPE_SECRET_KEY);
  return client;
}

const PRICE_IDS: Record<PaidPlanId, string> = {
  starter: config.STRIPE_PRICE_STARTER,
  plus: config.STRIPE_PRICE_PLUS,
  pro: config.STRIPE_PRICE_PRO,
  unlimited: config.STRIPE_PRICE_UNLIMITED,
};

export function priceForPlan(plan: PaidPlanId): string {
  const price = PRICE_IDS[plan];
  if (!price) throw new AppError(503, `No Stripe price configured for plan "${plan}"`);
  return price;
}

function planForPrice(priceId: string): PaidPlanId | null {
  const entry = Object.entries(PRICE_IDS).find(([, id]) => id === priceId);
  return entry ? (entry[0] as PaidPlanId) : null;
}

export async function findCustomerId(userId: string): Promise<string | null> {
  const row = await queryOne<{ stripe_customer_id: string }>(
    `SELECT stripe_customer_id FROM billing_customers WHERE user_id = $1`,
    [userId],
  );
  return row?.stripe_customer_id ?? null;
}

export async function getOrCreateCustomerId(userId: string, email: string | null): Promise<string> {
  const existing = await findCustomerId(userId);
  if (existing) return existing;
  const customer = await getStripe().customers.create({
    email: email ?? undefined,
    metadata: { user_id: userId },
  });
  // Two checkouts racing: keep whichever customer was stored first.
  const row = await queryOne<{ stripe_customer_id: string }>(
    `INSERT INTO billing_customers (user_id, stripe_customer_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
     RETURNING stripe_customer_id`,
    [userId, customer.id],
  );
  return row?.stripe_customer_id ?? customer.id;
}

// past_due keeps the plan while Stripe retries the card; the period end still bounds it.
const LIVE_STATUSES: ReadonlySet<Stripe.Subscription.Status> = new Set(['active', 'trialing', 'past_due']);

// Renewal webhooks can arrive a little after the period ends; don't drop the plan meanwhile.
const RENEWAL_GRACE_SECONDS = 24 * 60 * 60;

/**
 * Mirrors one Stripe subscription into `subscriptions`. Always re-reads the subscription
 * from Stripe, so webhooks arriving out of order cannot resurrect an old state.
 */
export async function syncSubscription(subscriptionId: string): Promise<void> {
  const sub = await getStripe().subscriptions.retrieve(subscriptionId);
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  const owner = await queryOne<{ user_id: string }>(
    `SELECT user_id FROM billing_customers WHERE stripe_customer_id = $1`,
    [customerId],
  );
  const userId = owner?.user_id ?? sub.metadata.user_id;
  if (!userId) throw new Error(`No user for Stripe customer ${customerId}`);

  const item = sub.items.data[0];
  const plan = item ? planForPrice(item.price.id) : null;

  if (plan && LIVE_STATUSES.has(sub.status)) {
    await query(
      `INSERT INTO subscriptions (user_id, plan, provider, provider_ref, expires_at, updated_at)
       VALUES ($1, $2, 'stripe', $3, to_timestamp($4), now())
       ON CONFLICT (user_id) DO UPDATE SET
         plan = EXCLUDED.plan,
         provider = EXCLUDED.provider,
         provider_ref = EXCLUDED.provider_ref,
         expires_at = EXCLUDED.expires_at,
         updated_at = now()`,
      [userId, plan, sub.id, sub.current_period_end + RENEWAL_GRACE_SECONDS],
    );
    return;
  }

  // Ended, unpaid or never completed: only remove the row if it is this subscription.
  await query(
    `DELETE FROM subscriptions WHERE user_id = $1 AND provider = 'stripe' AND provider_ref = $2`,
    [userId, sub.id],
  );
}
