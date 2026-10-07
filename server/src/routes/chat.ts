import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../db';
import { AppError } from '../lib/errors';
import { answerWithRag, type Citation } from '../lib/rag';
import { parseTimeExpressions } from '../lib/timeparse';

const chatSchema = z.object({
  message: z.string().min(1).max(4000),
  conversationId: z.string().uuid().optional(),
});

export default async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.post('/chat', async (request) => {
    const body = chatSchema.parse(request.body);
    const userId = request.userId;

    let conversationId = body.conversationId ?? null;
    if (conversationId) {
      const owned = await queryOne(
        `SELECT id FROM chat_conversations WHERE id = $1 AND user_id = $2`,
        [conversationId, userId],
      );
      if (!owned) throw new AppError(404, 'Conversation not found');
    } else {
      const conv = await queryOne<{ id: string }>(
        `INSERT INTO chat_conversations (user_id, title) VALUES ($1, $2) RETURNING id`,
        [userId, body.message.slice(0, 40)],
      );
      conversationId = conv?.id ?? null;
    }
    if (!conversationId) throw new AppError(500, 'Failed to create conversation');

    await query(
      `INSERT INTO chat_messages (conversation_id, user_id, role, content) VALUES ($1, $2, 'user', $3)`,
      [conversationId, userId, body.message],
    );

    const range = parseTimeExpressions(body.message);
    const { answer, citations } = await answerWithRag(userId, body.message, range);

    const saved = await queryOne<{ id: string }>(
      `INSERT INTO chat_messages (conversation_id, user_id, role, content, citations)
       VALUES ($1, $2, 'assistant', $3, $4::jsonb)
       RETURNING id`,
      [conversationId, userId, answer, JSON.stringify(citations)],
    );

    return { conversationId, messageId: saved?.id ?? null, answer, citations };
  });

  app.get('/chat/conversations', async (request) => {
    const conversations = await query<{ id: string; title: string; createdAt: Date }>(
      `SELECT id, title, created_at AS "createdAt"
       FROM chat_conversations
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [request.userId],
    );
    return { conversations };
  });

  app.get('/chat/conversations/:id/messages', async (request) => {
    const { id } = request.params as { id: string };
    const owned = await queryOne(
      `SELECT id FROM chat_conversations WHERE id = $1 AND user_id = $2`,
      [id, request.userId],
    );
    if (!owned) throw new AppError(404, 'Conversation not found');
    const messages = await query<{
      id: string;
      role: string;
      content: string;
      citations: Citation[] | null;
      createdAt: Date;
    }>(
      `SELECT id, role, content, citations, created_at AS "createdAt"
       FROM chat_messages
       WHERE conversation_id = $1 AND user_id = $2
       ORDER BY created_at ASC
       LIMIT 500`,
      [id, request.userId],
    );
    return { messages };
  });

  app.delete('/chat/conversations/:id', async (request) => {
    const { id } = request.params as { id: string };
    const deleted = await queryOne(
      `DELETE FROM chat_conversations WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, request.userId],
    );
    if (!deleted) throw new AppError(404, 'Conversation not found');
    return { ok: true };
  });
}
