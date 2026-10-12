import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../db';
import { AppError } from '../lib/errors';
import { answerWithRag, type Citation } from '../lib/rag';
import { parseTimeExpressions } from '../lib/timeparse';
import {
  ctx,
  decryptCitations,
  decryptText,
  encryptCitations,
  encryptText,
} from '../lib/crypto';

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
      // Ids are generated here (not by the database) because each encrypted
      // value is bound to the id of the row it is stored in.
      conversationId = randomUUID();
      await query(`INSERT INTO chat_conversations (id, user_id, title) VALUES ($1, $2, $3)`, [
        conversationId,
        userId,
        encryptText(body.message.slice(0, 40), ctx.conversationTitle(userId, conversationId)),
      ]);
    }

    const userMessageId = randomUUID();
    await query(
      `INSERT INTO chat_messages (id, conversation_id, user_id, role, content)
       VALUES ($1, $2, $3, 'user', $4)`,
      [
        userMessageId,
        conversationId,
        userId,
        encryptText(body.message, ctx.messageContent(userId, userMessageId)),
      ],
    );

    const historyRows = await query<{ id: string; role: 'user' | 'assistant'; content: string }>(
      `SELECT id, role, content FROM chat_messages
       WHERE conversation_id = $1 AND user_id = $2 AND id <> $3
       ORDER BY created_at DESC LIMIT 10`,
      [conversationId, userId, userMessageId],
    );
    const history = historyRows.reverse().map((m) => ({
      role: m.role,
      content: decryptText(m.content, ctx.messageContent(userId, m.id)).slice(0, 1000),
    }));

    const range = parseTimeExpressions(body.message);
    const { answer, citations } = await answerWithRag(userId, body.message, range, history);

    const messageId = randomUUID();
    await query(
      `INSERT INTO chat_messages (id, conversation_id, user_id, role, content, citations)
       VALUES ($1, $2, $3, 'assistant', $4, $5::jsonb)`,
      [
        messageId,
        conversationId,
        userId,
        encryptText(answer, ctx.messageContent(userId, messageId)),
        JSON.stringify(encryptCitations(citations, ctx.messageCitation(userId, messageId))),
      ],
    );

    return { conversationId, messageId, answer, citations };
  });

  app.get('/chat/conversations', async (request) => {
    const conversations = await query<{
      id: string;
      title: string;
      createdAt: Date;
      updatedAt: Date;
    }>(
      `SELECT c.id, c.title, c.created_at AS "createdAt",
              COALESCE(MAX(m.created_at), c.created_at) AS "updatedAt"
       FROM chat_conversations c
       LEFT JOIN chat_messages m ON m.conversation_id = c.id
       WHERE c.user_id = $1
       GROUP BY c.id
       ORDER BY "updatedAt" DESC
       LIMIT 50`,
      [request.userId],
    );
    return {
      conversations: conversations.map((c) => ({
        ...c,
        title: decryptText(c.title, ctx.conversationTitle(request.userId, c.id)),
      })),
    };
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
    return {
      messages: messages.map((m) => ({
        ...m,
        content: decryptText(m.content, ctx.messageContent(request.userId, m.id)),
        citations: decryptCitations(m.citations, ctx.messageCitation(request.userId, m.id)),
      })),
    };
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
