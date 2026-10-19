/**
 * Literal matching on decrypted transcript text: case- and accent-insensitive, with a
 * crude stem so Greek inflections still match ("καφές" finds "καφέ" and "καφεδάκι").
 */

/** Case- and accent-insensitive form of a string. */
export function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

// Common Greek and English words that say nothing about what to find.
const STOP_WORDS = new Set([
  'και', 'να', 'το', 'τα', 'τη', 'την', 'της', 'του', 'των', 'τον', 'τους', 'τις', 'ο', 'η', 'οι',
  'με', 'σε', 'στο', 'στη', 'στην', 'στα', 'στον', 'στις', 'στους', 'για', 'απο', 'που', 'πως',
  'τι', 'ποιο', 'ποια', 'ποιος', 'ειναι', 'ηταν', 'εχω', 'ειχα', 'ειπα', 'μου', 'σου', 'μας',
  'ενα', 'μια', 'ενας', 'δεν', 'θα', 'αν', 'ή', 'η', 'ολα', 'κατι', 'πολυ', 'οτι', 'αυτο',
  'the', 'and', 'what', 'did', 'about', 'with', 'that', 'this', 'for', 'was', 'were', 'have',
]);

/** Stems of the meaningful words in a query, deduplicated. */
export function queryStems(...sources: string[]): string[] {
  const stems = new Set<string>();
  for (const source of sources) {
    for (const word of normalizeText(source).split(/[^\p{L}\p{N}]+/u)) {
      if (word.length < 3 || STOP_WORDS.has(word)) continue;
      // Drop the inflected ending of longer words, keeping at least four letters.
      stems.add(word.length >= 6 ? word.slice(0, word.length - 2) : word.length === 5 ? word.slice(0, 4) : word);
    }
  }
  return [...stems];
}

export interface TextMatch {
  /** Share of stems found in the text, 0..1. */
  share: number;
  /** Whether the whole normalized phrase appears as typed. */
  phrase: boolean;
  /** [start, end) ranges in the original text, for highlighting. */
  ranges: Array<[number, number]>;
}

/**
 * Finds the stems in the text. Ranges cover each matching word in full and are given in
 * positions of the original string, so the app can highlight them directly.
 */
export function matchText(text: string, stems: string[], phrase = ''): TextMatch {
  // Normalize character by character so each normalized position maps back to the original.
  let normalized = '';
  const origin: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const piece = normalizeText(text[i] ?? '');
    for (let k = 0; k < piece.length; k += 1) {
      normalized += piece[k];
      origin.push(i);
    }
  }
  origin.push(text.length);

  const found = new Set<string>();
  const ranges: Array<[number, number]> = [];
  for (const stem of stems) {
    let from = 0;
    for (;;) {
      const at = normalized.indexOf(stem, from);
      if (at < 0) break;
      // Only count matches at the start of a word, then extend to the end of that word.
      const before = at === 0 ? '' : normalized[at - 1] ?? '';
      if (!/[\p{L}\p{N}]/u.test(before)) {
        found.add(stem);
        let end = at + stem.length;
        while (end < normalized.length && /[\p{L}\p{N}]/u.test(normalized[end] ?? '')) end += 1;
        ranges.push([origin[at] ?? 0, origin[end] ?? text.length]);
      }
      from = at + stem.length;
    }
  }

  const normalizedPhrase = normalizeText(phrase).trim();
  return {
    share: stems.length > 0 ? found.size / stems.length : 0,
    phrase: normalizedPhrase.length > 0 && normalized.includes(normalizedPhrase),
    ranges: mergeRanges(ranges),
  };
}

function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
}
