import type { FastifyInstance } from 'fastify';
import type Stripe from 'stripe';
import { config } from '../config';
import { getStripe, syncSubscription } from '../lib/stripe';

function subscriptionIdOf(event: Stripe.Event): string | null {
  const ref = (value: string | { id: string } | null | undefined): string | null =>
    value == null ? null : typeof value === 'string' ? value : value.id;

  switch (event.type) {
    case 'checkout.session.completed':
      return event.data.object.mode === 'subscription' ? ref(event.data.object.subscription) : null;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed':
      return event.data.object.id;
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      // Newer API versions (set per webhook endpoint) moved the field under `parent`.
      const invoice = event.data.object as Stripe.Invoice & {
        parent?: { subscription_details?: { subscription?: string | { id: string } | null } | null } | null;
      };
      return ref(invoice.subscription) ?? ref(invoice.parent?.subscription_details?.subscription);
    }
    default:
      return null;
  }
}

/**
 * Stripe → plan changes. Registered outside /v1 auth: Stripe proves itself with the
 * signature instead, which is checked against the exact raw body.
 */
export default async function stripeWebhookRoutes(app: FastifyInstance): Promise<void> {
  // Scoped to this plugin: other routes keep normal JSON parsing.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body);
  });

  app.post('/stripe/webhook', async (request, reply) => {
    if (!config.STRIPE_WEBHOOK_SECRET) {
      return reply.code(503).send({ error: 'Payments are not configured' });
    }
    const signature = request.headers['stripe-signature'];
    let event: Stripe.Event;
    try {
      event = getStripe().webhooks.constructEvent(
        request.body as Buffer,
        typeof signature === 'string' ? signature : '',
        config.STRIPE_WEBHOOK_SECRET,
      );
    } catch {
      return reply.code(400).send({ error: 'Invalid signature' });
    }

    const subscriptionId = subscriptionIdOf(event);
    // A throw here answers 500, and Stripe retries the event later.
    if (subscriptionId) await syncSubscription(subscriptionId);
    return { received: true };
  });
}
