import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../db';
import { assertChatAllowance } from '../lib/billing';
import { AppError } from '../lib/errors';
import { answerWithRag, suggestFollowUps, type Citation } from '../lib/rag';
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

interface Turn {
  conversationId: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
}

/** Opens or continues a conversation, saves the question and loads the recent history. */
async function startTurn(userId: string, body: z.infer<typeof chatSchema>): Promise<Turn> {
  await assertChatAllowance(userId);
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
  return { conversationId, history };
}

async function saveAnswer(
  userId: string,
  conversationId: string,
  answer: string,
  citations: Citation[],
): Promise<string> {
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
  return messageId;
}

export default async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.post('/chat', async (request) => {
    const body = chatSchema.parse(request.body);
    const userId = request.userId;
    const { conversationId, history } = await startTurn(userId, body);
    const { answer, citations } = await answerWithRag(userId, body.message, history);
    const messageId = await saveAnswer(userId, conversationId, answer, citations);
    return { conversationId, messageId, answer, citations };
  });

  /**
   * The same answer as POST /chat, streamed as server-sent events:
   *   start {conversationId} -> status {text}... -> delta {text}... -> done {messageId, answer, citations, followUps}
   * or error {message}. Delta text still contains [n] source markers; done has the clean answer.
   */
  app.post('/chat/stream', async (request, reply) => {
    const body = chatSchema.parse(request.body);
    const userId = request.userId;
    // Fails as a normal JSON error (e.g. unknown conversation) before the stream starts.
    const { conversationId, history } = await startTurn(userId, body);

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Proxies must pass each event on as it is written.
      'X-Accel-Buffering': 'no',
    });
    const send = (event: string, data: unknown): void => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      send('start', { conversationId });
      const { answer, citations } = await answerWithRag(userId, body.message, history, {
        onStatus: (text) => send('status', { text }),
        onDelta: (text) => send('delta', { text }),
      });
      const [messageId, followUps] = await Promise.all([
        saveAnswer(userId, conversationId, answer, citations),
        suggestFollowUps(body.message, answer),
      ]);
      send('done', { conversationId, messageId, answer, citations, followUps });
    } catch (err) {
      request.log.error({ err }, 'chat stream failed');
      send('error', { message: 'Δεν ήταν δυνατή η απάντηση. Δοκίμασε ξανά.' });
    } finally {
      reply.raw.end();
    }
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
