import type { FastifyReply, FastifyRequest } from 'fastify';
import { supabaseAuth } from './supabase';

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    await reply.code(401).send({ error: 'Missing bearer token' });
    return;
  }
  const token = header.slice('Bearer '.length).trim();
  const { data, error } = await supabaseAuth.auth.getUser(token);
  if (error || !data.user) {
    await reply.code(401).send({ error: 'Invalid or expired token' });
    return;
  }
  request.userId = data.user.id;
}
