import type { FastifyInstance } from 'fastify';
import type Stripe from 'stripe';
import { z } from 'zod';
import { config } from '../config';
import { getBillingStatus } from '../lib/billing';
import { AppError } from '../lib/errors';
import { findCustomerId, getOrCreateCustomerId, getStripe, priceForPlan } from '../lib/stripe';

const checkoutSchema = z.object({
  plan: z.enum(['starter', 'plus', 'pro', 'unlimited']),
});

const accountUrl = (query = ''): string => `${config.WEBSITE_URL.replace(/\/+$/, '')}/account${query}`;

async function liveSubscription(customerId: string): Promise<Stripe.Subscription | null> {
  const { data } = await getStripe().subscriptions.list({ customer: customerId, status: 'all', limit: 10 });
  return data.find((sub) => ['active', 'trialing', 'past_due'].includes(sub.status)) ?? null;
}

async function portalUrl(customerId: string, flow?: Stripe.BillingPortal.SessionCreateParams.FlowData): Promise<string> {
  const session = await getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: accountUrl(),
    ...(flow ? { flow_data: flow } : {}),
  });
  return session.url;
}

export default async function billingRoutes(app: FastifyInstance): Promise<void> {
  app.get('/billing', async (request) => getBillingStatus(request.userId));

  // Starts a subscription on the website. Someone already subscribed is sent to the
  // billing portal to confirm the switch instead, so nobody ends up paying twice.
  app.post('/billing/checkout', async (request) => {
    const { plan } = checkoutSchema.parse(request.body);
    const price = priceForPlan(plan);

    // A plan bought in an app store can only be changed there. A plan granted by hand
    // ('manual') is simply replaced by the Stripe subscription once it starts.
    const status = await getBillingStatus(request.userId);
    if (status.provider === 'app_store' || status.provider === 'play_store') {
      throw new AppError(409, 'Your plan was bought in the app store; change it there');
    }

    const customerId = await getOrCreateCustomerId(request.userId, request.userEmail);
    const current = await liveSubscription(customerId);
    if (current) {
      const item = current.items.data[0];
      if (!item || item.price.id === price) return { url: await portalUrl(customerId) };
      try {
        return {
          url: await portalUrl(customerId, {
            type: 'subscription_update_confirm',
            subscription_update_confirm: {
              subscription: current.id,
              items: [{ id: item.id, price, quantity: 1 }],
            },
          }),
        };
      } catch {
        // Plan switching is not enabled in the portal settings: open the portal as is.
        return { url: await portalUrl(customerId) };
      }
    }

    const session = await getStripe().checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: request.userId,
      line_items: [{ price, quantity: 1 }],
      subscription_data: { metadata: { user_id: request.userId } },
      allow_promotion_codes: true,
      success_url: accountUrl('?checkout=success'),
      cancel_url: accountUrl('?checkout=cancelled'),
    });
    if (!session.url) throw new AppError(502, 'Stripe did not return a checkout page');
    return { url: session.url };
  });

  // Stripe's own page for changing plan, card, invoices, or cancelling.
  app.post('/billing/portal', async (request) => {
    const customerId = await findCustomerId(request.userId);
    if (!customerId) throw new AppError(404, 'No subscription to manage');
    return { url: await portalUrl(customerId) };
  });
}
