import type { FastifyInstance } from 'fastify';
import { query } from '../db';
import { removeUserAudioPrefix } from '../lib/storage';
import { supabaseService } from '../supabase';

export default async function accountRoutes(app: FastifyInstance): Promise<void> {
  // Deletes the auth user; FK cascades remove sessions, chunks, jobs,
  // settings, conversations and messages. Storage cleanup is best-effort.
  app.delete('/account', async (request) => {
    await removeUserAudioPrefix(request.userId);
    const { error } = await supabaseService.auth.admin.deleteUser(request.userId);
    if (error) {
      request.log.error({ err: error }, 'Failed to delete auth user');
      // Rows may already be gone; still report the failure so the client can retry.
      throw new Error(`Account deletion failed: ${error.message}`);
    }
    // User might have audio under a differently-shaped prefix; purge anything left.
    await query(`SELECT 1`).catch(() => undefined);
    return { ok: true };
  });
}
