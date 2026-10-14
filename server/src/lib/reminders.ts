import { randomUUID } from 'node:crypto';
import { pool, queryOne } from '../db';
import { config } from '../config';
import { getLlmProvider } from '../providers';
import { ctx, decryptText, encryptText } from './crypto';
import { formatZoned, zonedToUtc } from './zonedtime';

const MAX_PER_CHUNK = 3;
const MAX_TEXT_LENGTH = 200;

// Words that come up when someone mentions something to do. Chunks without any of them
// skip the LLM call; most recorded speech is not about tasks. Accents are stripped first.
const TRIGGERS = [
  'θυμ', 'ξεχασ', 'ξεχνα', 'πρεπει', 'χρειαζεται να', 'ραντεβου', 'αυριο', 'μεθαυριο',
  'να παρω', 'να στειλω', 'να αγορασω', 'να πληρωσω', 'να κλεισω', 'να φερω', 'προθεσμια',
  'remind', 'forget', 'need to', 'have to', 'tomorrow', 'appointment', 'deadline',
];

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function mightMentionTask(text: string): boolean {
  const normalized = normalize(text);
  return TRIGGERS.some((trigger) => normalized.includes(trigger));
}

interface ExtractedReminder {
  text: string;
  due: string | null;
}

function parseExtraction(raw: string): ExtractedReminder[] {
  const cleaned = raw.replace(/```(?:json)?/g, '').trim();
  const parsed: unknown = JSON.parse(cleaned);
  const list = (parsed as { reminders?: unknown }).reminders;
  if (!Array.isArray(list)) return [];
  return list
    .filter(
      (item): item is { text: string; due?: unknown } =>
        typeof item === 'object' && item !== null && typeof (item as { text?: unknown }).text === 'string',
    )
    .map((item) => ({
      text: item.text.trim().slice(0, MAX_TEXT_LENGTH),
      due: typeof item.due === 'string' ? item.due : null,
    }))
    .filter((item) => item.text.length > 0)
    .slice(0, MAX_PER_CHUNK);
}

/** Asks the LLM for reminders in an excerpt. "due" comes back as local wall-clock time. */
export async function extractReminders(
  text: string,
  previousText: string,
  recordedAt: Date,
  timezone: string,
): Promise<ExtractedReminder[]> {
  const raw = await getLlmProvider().chat(
    [
      {
        role: 'system',
        content:
          'You find reminders in transcripts of a user\'s own voice recordings. ' +
          'Recordings can include other people, TV or radio, so only include something when the speaker ' +
          'clearly means a task for themselves: an explicit request to be reminded ("θύμισέ μου", "remind me"), ' +
          'or a first-person intention or obligation ("πρέπει να…", "να μην ξεχάσω να…", "I need to…"). ' +
          'Ignore tasks for other people, things already done, hypotheticals and anything vague. ' +
          'Only extract from the CURRENT excerpt; the previous excerpt is context for a sentence cut in half. ' +
          'Write each reminder as a short Greek to-do (ελληνικά, max 12 words) that starts with an imperative verb ' +
          'and leaves out "θύμισέ μου", "πρέπει να" and the time, e.g. "Πάρε τηλέφωνο τον γιατρό", "Πλήρωσε τον λογαριασμό της ΔΕΗ". ' +
          'For "due", resolve any time mentioned relative to when the excerpt was recorded and give local time as "YYYY-MM-DDTHH:mm". ' +
          'A day without a time means 09:00 that day. No time mentioned means null. ' +
          'Output ONLY JSON: {"reminders":[{"text":"...","due":"YYYY-MM-DDTHH:mm" or null}]}. ' +
          'Most excerpts contain none: then output {"reminders":[]}.',
      },
      {
        role: 'user',
        content:
          `Recorded at (local time): ${formatZoned(recordedAt, timezone)}\n\n` +
          (previousText ? `PREVIOUS excerpt:\n${previousText}\n\n` : '') +
          `CURRENT excerpt:\n${text}`,
      },
    ],
    { temperature: 0 },
  );

  return parseExtraction(raw);
}

interface ReminderPrefs {
  timezone: string;
  autoCreate: boolean;
}

async function reminderPrefs(userId: string): Promise<ReminderPrefs> {
  const row = await queryOne<{ timezone: string | null; auto_reminders: boolean }>(
    `SELECT timezone, auto_reminders FROM user_settings WHERE user_id = $1`,
    [userId],
  );
  return {
    timezone: row?.timezone ?? config.BILLING_TIMEZONE,
    autoCreate: row?.auto_reminders ?? false,
  };
}

interface SourceChunk {
  id: string;
  user_id: string;
  session_id: string;
  started_at: Date;
}

/**
 * Looks for things the user said they need to do in a freshly transcribed chunk and
 * stores them as reminders: suggestions the user confirms in the app, or ready-made
 * reminders when the user turned on auto-create.
 * Best effort: callers should not fail the chunk if this throws.
 */
export async function suggestRemindersFromChunk(chunk: SourceChunk, text: string): Promise<void> {
  // A sentence can be cut at a chunk boundary, so the previous chunk is passed as context.
  const previous = await queryOne<{ id: string; text: string }>(
    `SELECT id, text FROM transcript_chunks
     WHERE session_id = $1 AND started_at < $2 AND text <> ''
     ORDER BY started_at DESC
     LIMIT 1`,
    [chunk.session_id, chunk.started_at],
  );
  const previousText = previous ? decryptText(previous.text, ctx.chunkText(chunk.user_id, previous.id)) : '';
  if (!mightMentionTask(`${previousText} ${text}`)) return;

  const { timezone, autoCreate } = await reminderPrefs(chunk.user_id);
  const found = await extractReminders(text, previousText, chunk.started_at, timezone);
  // With auto-create on, reminders skip the confirmation step and get notifications directly.
  const status = autoCreate ? 'pending' : 'suggested';
  const now = Date.now();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // A retried chunk replaces what it created before instead of adding duplicates.
    await client.query(
      `DELETE FROM reminders WHERE source_chunk_id = $1 AND status IN ('suggested', 'pending')`,
      [chunk.id],
    );
    for (const item of found) {
      const due = item.due ? zonedToUtc(item.due, timezone) : null;
      const id = randomUUID();
      await client.query(
        `INSERT INTO reminders (id, user_id, text, due_at, status, source_chunk_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          id,
          chunk.user_id,
          encryptText(item.text, ctx.reminderText(chunk.user_id, id)),
          due && due.getTime() > now ? due.toISOString() : null,
          status,
          chunk.id,
        ],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

