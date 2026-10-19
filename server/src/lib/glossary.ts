import { randomUUID } from 'node:crypto';
import { query } from '../db';
import { getLlmProvider } from '../providers';
import { ctx, decryptText, encryptText } from './crypto';
import { normalizeText } from './textmatch';

/**
 * The user's own vocabulary: names of people, places, businesses and things they mention,
 * with the misheard spellings seen for each. It steers transcription, fixes names in
 * transcripts, widens search to the variants and tells chat who or what a name is.
 */

export type TermKind = 'person' | 'place' | 'business' | 'thing' | 'other';
const KINDS: TermKind[] = ['person', 'place', 'business', 'thing', 'other'];

export interface Term {
  id: string;
  term: string;
  kind: TermKind;
  note: string;
  variants: string[];
  mentions: number;
  source: 'auto' | 'user';
  hidden: boolean;
  lastSeenAt: Date;
}

interface TermRow {
  id: string;
  term: string;
  kind: TermKind;
  note: string;
  variants: string;
  mentions: number;
  source: 'auto' | 'user';
  hidden: boolean;
  last_seen_at: Date;
}

// Names handed to the models per call; the most mentioned and most recent first.
const PROMPT_TERMS = 60;
const MAX_VARIANTS = 8;

export async function loadTerms(userId: string): Promise<Term[]> {
  const rows = await query<TermRow>(
    `SELECT id, term, kind, note, variants, mentions, source, hidden, last_seen_at
     FROM user_terms WHERE user_id = $1
     ORDER BY mentions DESC, last_seen_at DESC`,
    [userId],
  );
  return rows.map((r) => {
    const variantsJson = r.variants ? decryptText(r.variants, ctx.term(userId, r.id, 'variants')) : '';
    let variants: string[] = [];
    try {
      variants = variantsJson ? (JSON.parse(variantsJson) as string[]) : [];
    } catch {
      variants = [];
    }
    return {
      id: r.id,
      term: decryptText(r.term, ctx.term(userId, r.id, 'term')),
      kind: r.kind,
      note: r.note ? decryptText(r.note, ctx.term(userId, r.id, 'note')) : '',
      variants,
      mentions: r.mentions,
      source: r.source,
      hidden: r.hidden,
      lastSeenAt: r.last_seen_at,
    };
  });
}

/**
 * The vocabulary for transcription, chat and search, which work without it: a failure here
 * (e.g. the server deployed before migration 0011) must not stop recordings being processed.
 */
export async function loadTermsOrEmpty(userId: string): Promise<Term[]> {
  try {
    return await loadTerms(userId);
  } catch (err) {
    console.error('[glossary] could not load terms', err instanceof Error ? err.message : err);
    return [];
  }
}

/** Visible terms worth giving a model, best known first. */
export function topTerms(terms: Term[], limit = PROMPT_TERMS): Term[] {
  return terms.filter((t) => !t.hidden).slice(0, limit);
}

/** One line per term, e.g. "Πατάρας (business): συνεργείο αυτοκινήτου". */
export function describeTerms(terms: Term[]): string {
  return terms.map((t) => `${t.term} (${t.kind})${t.note ? `: ${t.note}` : ''}`).join('\n');
}

/**
 * Prompt for the transcription model: known names, then the end of the previous chunk so a
 * sentence cut at the chunk boundary continues correctly.
 */
export function transcriptionPrompt(terms: Term[], previousText: string): string {
  const names = topTerms(terms, 40).map((t) => t.term);
  const tail = previousText.trim().slice(-300);
  return [names.length > 0 ? `Ονόματα: ${names.join(', ')}.` : '', tail].filter(Boolean).join('\n');
}

/** Words to search for as well: each query word that names a term brings its other spellings. */
export function expandWithVariants(words: string[], terms: Term[]): string[] {
  const out = new Set(words);
  for (const word of words) {
    const n = normalizeText(word);
    if (n.length < 3) continue;
    for (const t of terms) {
      if (t.hidden) continue;
      const spellings = [t.term, ...t.variants];
      if (spellings.some((s) => sameName(normalizeText(s), n))) spellings.forEach((s) => out.add(s));
    }
  }
  return [...out];
}

// Greek case endings, longest first; stripping one leaves the part shared by all cases.
const ENDINGS = ['ους', 'ων', 'ου', 'ης', 'ες', 'ας', 'ος', 'α', 'η', 'ο', 'ε', 'ς', 'ι', 'υ', 'ν'];

function nameRoot(normalized: string): string {
  for (const ending of ENDINGS) {
    if (normalized.endsWith(ending) && normalized.length - ending.length >= 3) {
      return normalized.slice(0, normalized.length - ending.length);
    }
  }
  return normalized;
}

/** Same name in another case: "πατάρα" and "πατάρας", "γιώργο" and "γιώργος", but not "μαρία" and "μαρίνα". */
export function sameName(a: string, b: string): boolean {
  return a === b || nameRoot(a) === nameRoot(b);
}

export interface FoundTerm {
  term: string;
  kind: TermKind;
  note: string;
  variants: string[];
}

export interface Revision {
  /** The transcript with names and clearly misheard words corrected. */
  text: string;
  terms: FoundTerm[];
}

const REVISE_SYSTEM = `You proofread one automatic transcript of a person's own voice note (usually Greek) and list the names in it.
Output ONLY JSON: {"text": string, "terms": [{"term": string, "kind": "person"|"place"|"business"|"thing", "note": string, "variants": string[]}]}

text:
- The transcript with only these fixes: names spelled as in the KNOWN NAMES list when the transcript clearly means one of them (e.g. "Μπατάρα" for "Πατάρας", inflected as the sentence needs), and words that were clearly misheard into nonsense where the intended word is obvious from context ("Τα κρεμμότητα" -> "Εκκρεμότητα").
- Do not rephrase, reorder, summarise, translate or add anything. Keep numbers, amounts and times exactly. Keep the speaker's grammar and slang. When unsure, leave it as it is.
- If the transcript is not in Greek, return it unchanged; never translate it.

terms: proper names that appear in THIS transcript: people, named businesses and shops, named places, brands, products and vehicle models.
- Only proper names, as spoken in this transcript. Never list a KNOWN NAME that is not in this transcript.
- Not common nouns (ταβέρνα, γιατρός, δουλειά, σχολείο, εκκλησία), not job titles, not days, months or dates, not the speaker. When unsure whether a word is a name, leave it out.
- term: the canonical spelling in the nominative (e.g. "Πατάρας", "Θεοδόρα", "Άγιος Αθανάσιος"); reuse a KNOWN NAMES spelling for the same name.
- note: what it is in a few Greek words, only if THIS transcript says so (e.g. "συνεργείο αυτοκινήτου", "κλειδαράς", "πελάτης στη Δράμα"); otherwise "".
- variants: other spellings of this name that appear in the ORIGINAL transcript, if any.`;

/** Corrects names in a fresh transcript and collects the names it mentions. Throws on model failure. */
export async function reviseTranscript(text: string, previousText: string, terms: Term[]): Promise<Revision> {
  const known = describeTerms(topTerms(terms));
  const raw = await getLlmProvider().chat(
    [
      { role: 'system', content: REVISE_SYSTEM },
      {
        role: 'user',
        content:
          `KNOWN NAMES:\n${known || '(none yet)'}\n\n` +
          (previousText ? `PREVIOUS CHUNK (context only):\n${previousText.slice(-500)}\n\n` : '') +
          `TRANSCRIPT:\n${text}`,
      },
    ],
    { temperature: 0, json: true },
  );
  const parsed = JSON.parse(raw) as { text?: unknown; terms?: unknown };
  const revised = typeof parsed.text === 'string' ? parsed.text.trim() : '';

  const found: FoundTerm[] = Array.isArray(parsed.terms)
    ? parsed.terms
        .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
        .map((t) => ({
          term: typeof t.term === 'string' ? t.term.trim().slice(0, 80) : '',
          kind: KINDS.includes(t.kind as TermKind) ? (t.kind as TermKind) : 'other',
          note: typeof t.note === 'string' ? t.note.trim().slice(0, 120) : '',
          variants: Array.isArray(t.variants)
            ? t.variants.filter((v): v is string => typeof v === 'string' && v.trim().length > 1).map((v) => v.trim())
            : [],
        }))
        .filter((t) => t.term.length > 1)
        // Models sometimes list known names that this note never mentions.
        .filter((t) => [t.term, ...t.variants].some((name) => mentions(text, name) || mentions(revised, name)))
    : [];

  return { text: acceptRevision(text, revised) ? revised : text, terms: found };
}

/** Whether every word of the name appears in the text, in any case form. */
export function mentions(text: string, name: string): boolean {
  const words = normalizeText(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const parts = normalizeText(name).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return (
    parts.length > 0 &&
    parts.every((part) => words.some((w) => w === part || nameRoot(w) === nameRoot(part)))
  );
}

function letterCount(text: string, script: RegExp): number {
  return (text.match(script) ?? []).length;
}

/** Edit distance between two short words. */
function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length]!;
}

/**
 * A proofread must stay a proofread: refuse it when it changes the length noticeably or
 * rewrites more than a small share of the words. A word fixed by a letter or two ("Μπατάρα"
 * to "Πατάρα", "στο" to "στον") still counts as kept, so short notes can have a name fixed.
 */
export function acceptRevision(original: string, revised: string): boolean {
  if (!revised) return false;
  // Same alphabet in, same alphabet out: a changed script means a translation.
  for (const script of [/[\u0400-\u04FF]/g, /[\u0370-\u03FF\u1F00-\u1FFF]/g, /[A-Za-z]/g]) {
    const before = letterCount(original, script);
    const after = letterCount(revised, script);
    if (Math.abs(after - before) > Math.max(3, before * 0.1)) return false;
  }
  const ratio = revised.length / Math.max(1, original.length);
  if (ratio < 0.85 || ratio > 1.15) return false;
  const words = (s: string): string[] => normalizeText(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const before = words(original);
  const after = words(revised);
  const kept = before.filter((w) =>
    after.some((v) => v === w || distance(v, w) <= Math.max(1, Math.floor(w.length / 4))),
  ).length;
  return kept / Math.max(1, before.length) >= 0.8;
}

/**
 * Adds new names and counts repeat mentions. A term the user wrote or hid keeps its name and
 * note; misheard spellings are still collected as variants.
 */
export async function recordTerms(userId: string, found: FoundTerm[], existing: Term[]): Promise<void> {
  const seen = new Set<string>();
  for (const f of found) {
    const key = normalizeText(f.term);
    if (seen.has(key)) continue;
    seen.add(key);

    const match = existing.find((t) =>
      [t.term, ...t.variants].some((s) => sameName(normalizeText(s), key)),
    );
    if (match) {
      const variants = mergeVariants(match, [f.term, ...f.variants]);
      const fillNote = match.source === 'auto' && !match.note && f.note;
      await query(
        `UPDATE user_terms
         SET mentions = mentions + 1, last_seen_at = now(), updated_at = now(),
             variants = $3, note = CASE WHEN $4::text IS NULL THEN note ELSE $4 END
         WHERE id = $1 AND user_id = $2`,
        [
          match.id,
          userId,
          encryptText(JSON.stringify(variants), ctx.term(userId, match.id, 'variants')),
          fillNote ? encryptText(f.note, ctx.term(userId, match.id, 'note')) : null,
        ],
      );
      match.variants = variants;
      match.mentions += 1;
      continue;
    }

    const id = randomUUID();
    const variants = mergeVariants({ term: f.term, variants: [] }, f.variants);
    await query(
      `INSERT INTO user_terms (id, user_id, term, kind, note, variants, source)
       VALUES ($1, $2, $3, $4, $5, $6, 'auto')`,
      [
        id,
        userId,
        encryptText(f.term, ctx.term(userId, id, 'term')),
        f.kind,
        f.note ? encryptText(f.note, ctx.term(userId, id, 'note')) : '',
        encryptText(JSON.stringify(variants), ctx.term(userId, id, 'variants')),
      ],
    );
    existing.push({
      id,
      term: f.term,
      kind: f.kind,
      note: f.note,
      variants,
      mentions: 1,
      source: 'auto',
      hidden: false,
      lastSeenAt: new Date(),
    });
  }
}

function mergeVariants(term: Pick<Term, 'term' | 'variants'>, spellings: string[]): string[] {
  const canonical = normalizeText(term.term);
  const out = [...term.variants];
  for (const s of spellings) {
    // Another case of a spelling already known is not a new variant.
    const n = normalizeText(s);
    if (sameName(n, canonical) || out.some((v) => sameName(normalizeText(v), n))) continue;
    out.push(s);
  }
  return out.slice(0, MAX_VARIANTS);
}
