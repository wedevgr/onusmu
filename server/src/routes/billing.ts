import type { FastifyInstance } from 'fastify';
import { getBillingStatus } from '../lib/billing';

export default async function billingRoutes(app: FastifyInstance): Promise<void> {
  app.get('/billing', async (request) => getBillingStatus(request.userId));
}
