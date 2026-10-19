import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../db';
import { AppError } from '../lib/errors';
import { ctx, encryptText } from '../lib/crypto';
import { loadTerms, type Term } from '../lib/glossary';
import { normalizeText } from '../lib/textmatch';

const kindSchema = z.enum(['person', 'place', 'business', 'thing', 'other']);

const createSchema = z.object({
  term: z.string().trim().min(2).max(80),
  kind: kindSchema.default('other'),
  note: z.string().trim().max(120).default(''),
});

const updateSchema = z.object({
  term: z.string().trim().min(2).max(80).optional(),
  kind: kindSchema.optional(),
  note: z.string().trim().max(120).optional(),
});

function toJson(t: Term) {
  return {
    id: t.id,
    term: t.term,
    kind: t.kind,
    note: t.note,
    variants: t.variants,
    mentions: t.mentions,
    source: t.source,
    lastSeenAt: t.lastSeenAt.toISOString(),
  };
}

export default async function termRoutes(app: FastifyInstance): Promise<void> {
  // Names the user mentions, most mentioned first. Hidden ones were removed by the user.
  app.get('/terms', async (request) => {
    const terms = await loadTerms(request.userId);
    return { terms: terms.filter((t) => !t.hidden).map(toJson) };
  });

  app.post('/terms', async (request) => {
    const body = createSchema.parse(request.body);
    const userId = request.userId;
    const id = randomUUID();
    await query(
      `INSERT INTO user_terms (id, user_id, term, kind, note, variants, source)
       VALUES ($1, $2, $3, $4, $5, $6, 'user')`,
      [
        id,
        userId,
        encryptText(body.term, ctx.term(userId, id, 'term')),
        body.kind,
        body.note ? encryptText(body.note, ctx.term(userId, id, 'note')) : '',
        encryptText('[]', ctx.term(userId, id, 'variants')),
      ],
    );
    const created = (await loadTerms(userId)).find((t) => t.id === id);
    return { term: created ? toJson(created) : null };
  });

  // Editing a term makes it the user's: later recordings no longer change its name or note.
  app.patch('/terms/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = updateSchema.parse(request.body);
    const userId = request.userId;
    const current = (await loadTerms(userId)).find((t) => t.id === id);
    if (!current) throw new AppError(404, 'Term not found');
    // A renamed term keeps its old spelling as a variant, so older notes still match it.
    const renamed = body.term !== undefined && normalizeText(body.term) !== normalizeText(current.term);
    const variants = renamed
      ? [...current.variants, current.term].filter((v) => normalizeText(v) !== normalizeText(body.term!))
      : null;
    const updated = await queryOne(
      `UPDATE user_terms SET
         term = COALESCE($3, term),
         kind = COALESCE($4, kind),
         note = COALESCE($5, note),
         variants = COALESCE($6, variants),
         source = 'user',
         updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [
        id,
        userId,
        body.term ? encryptText(body.term, ctx.term(userId, id, 'term')) : null,
        body.kind ?? null,
        body.note !== undefined ? (body.note ? encryptText(body.note, ctx.term(userId, id, 'note')) : '') : null,
        variants ? encryptText(JSON.stringify(variants), ctx.term(userId, id, 'variants')) : null,
      ],
    );
    if (!updated) throw new AppError(404, 'Term not found');
    const term = (await loadTerms(userId)).find((t) => t.id === id);
    return { term: term ? toJson(term) : null };
  });

  // Hidden rather than deleted, so the same name is not collected again from the next recording.
  app.delete('/terms/:id', async (request) => {
    const { id } = request.params as { id: string };
    const hidden = await queryOne(
      `UPDATE user_terms SET hidden = true, updated_at = now() WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, request.userId],
    );
    if (!hidden) throw new AppError(404, 'Term not found');
    return { ok: true };
  });
}
