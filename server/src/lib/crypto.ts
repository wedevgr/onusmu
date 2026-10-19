import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * At-rest encryption (AES-256-GCM) for everything user-authored: transcripts,
 * stored audio, chat titles/messages/citations.
 *
 * Text format   enc:v2:<keyId>:<iv>:<tag>:<ciphertext>   (base64 parts)
 * Binary format NAIENC2\0 | keyIdLen(1) | keyId | iv(12) | tag(16) | ciphertext
 *
 * - keyId names the key that encrypted the value, so keys can be rotated:
 *   new writes use the active key, old values stay readable until re-encrypted.
 * - Every value is bound (GCM additional authenticated data) to the row it
 *   belongs to, so ciphertext copied into another user's row fails to decrypt.
 *
 * Legacy formats (enc:v1:..., NAIENC1, plaintext) carry neither a key id nor a
 * binding. They are readable until `npm run encrypt:existing` has upgraded
 * them; set ENCRYPTION_REJECT_LEGACY=true afterwards to refuse them.
 */

const TEXT_V1 = 'enc:v1:';
const TEXT_V2 = 'enc:v2:';
const BINARY_V1 = Buffer.from('NAIENC1\0', 'latin1');
const BINARY_V2 = Buffer.from('NAIENC2\0', 'latin1');
const LEGACY_KEY_ID = '1';
const KEY_ID_RE = /^[A-Za-z0-9_-]{1,16}$/;

function parseKey(hex: string, label: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      `${label} must be 64 hex characters (32 bytes). ` +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  return Buffer.from(hex, 'hex');
}

function loadKeyring(): { keys: Map<string, Buffer>; activeId: string } {
  const keys = new Map<string, Buffer>();

  // Single-key setup: CHAT_ENCRYPTION_KEY is key "1".
  const single = (process.env.CHAT_ENCRYPTION_KEY ?? '').trim();
  if (single) keys.set(LEGACY_KEY_ID, parseKey(single, 'CHAT_ENCRYPTION_KEY'));

  // Rotation setup: ENCRYPTION_KEYS=1:<hex>,2:<hex> + ENCRYPTION_ACTIVE_KEY_ID=2
  const ring = (process.env.ENCRYPTION_KEYS ?? '').trim();
  if (ring) {
    for (const entry of ring.split(',')) {
      const [id, hex, ...rest] = entry.trim().split(':');
      if (!id || !hex || rest.length > 0 || !KEY_ID_RE.test(id)) {
        throw new Error('ENCRYPTION_KEYS must look like "1:<64 hex>,2:<64 hex>"');
      }
      keys.set(id, parseKey(hex, `ENCRYPTION_KEYS entry "${id}"`));
    }
  }

  if (keys.size === 0) {
    throw new Error(
      'No encryption key configured. Set CHAT_ENCRYPTION_KEY to 64 hex characters (32 bytes). ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }

  const activeId = (process.env.ENCRYPTION_ACTIVE_KEY_ID ?? '').trim() || LEGACY_KEY_ID;
  if (!keys.has(activeId)) {
    throw new Error(
      `ENCRYPTION_ACTIVE_KEY_ID is "${activeId}" but no key with that id is configured`,
    );
  }
  return { keys, activeId };
}

const { keys: KEYS, activeId: ACTIVE_KEY_ID } = loadKeyring();
const REJECT_LEGACY = (process.env.ENCRYPTION_REJECT_LEGACY ?? '').trim().toLowerCase() === 'true';

/** Prefix of text values encrypted with the active key (for "needs upgrade" queries). */
export const ACTIVE_TEXT_PREFIX = `${TEXT_V2}${ACTIVE_KEY_ID}:`;

function keyFor(id: string): Buffer {
  const key = KEYS.get(id);
  if (!key) throw new Error(`Encryption key "${id}" is not configured; cannot decrypt`);
  return key;
}

/** What a ciphertext is bound to. Build these with the helpers below. */
export type EncryptionContext = string;

export const ctx = {
  chunkText: (userId: string, chunkId: string): EncryptionContext =>
    `chunk.text|${userId}|${chunkId}`,
  conversationTitle: (userId: string, conversationId: string): EncryptionContext =>
    `conversation.title|${userId}|${conversationId}`,
  messageContent: (userId: string, messageId: string): EncryptionContext =>
    `message.content|${userId}|${messageId}`,
  messageCitation: (userId: string, messageId: string): EncryptionContext =>
    `message.citation|${userId}|${messageId}`,
  reminderText: (userId: string, reminderId: string): EncryptionContext =>
    `reminder.text|${userId}|${reminderId}`,
  factData: (userId: string, factId: string): EncryptionContext => `fact.data|${userId}|${factId}`,
  chunkInsights: (userId: string, chunkId: string): EncryptionContext =>
    `chunk.insights|${userId}|${chunkId}`,
  term: (userId: string, termId: string, field: 'term' | 'note' | 'variants'): EncryptionContext =>
    `term.${field}|${userId}|${termId}`,
  /** Storage paths are '<user_id>/<chunk_id>.m4a', so the path identifies owner and chunk. */
  audio: (path: string): EncryptionContext => `audio|${path}`,
};

export interface DecryptOptions {
  /** Accept v1/plaintext values. Defaults to the opposite of ENCRYPTION_REJECT_LEGACY. */
  allowLegacy?: boolean;
}

function assertLegacyAllowed(options: DecryptOptions | undefined, context: EncryptionContext): void {
  if (!(options?.allowLegacy ?? !REJECT_LEGACY)) {
    throw new Error(`Refusing unbound legacy value for ${context.split('|')[0]}`);
  }
}

export function encryptText(plaintext: string, context: EncryptionContext): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(ACTIVE_KEY_ID), iv);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ACTIVE_TEXT_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

export function decryptText(
  value: string,
  context: EncryptionContext,
  options?: DecryptOptions,
): string {
  if (value === '') return value;

  if (value.startsWith(TEXT_V2)) {
    const [keyId, ivB64, tagB64, ctB64] = value.slice(TEXT_V2.length).split(':');
    const decipher = createDecipheriv('aes-256-gcm', keyFor(keyId), Buffer.from(ivB64, 'base64'));
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64 ?? '', 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  assertLegacyAllowed(options, context);
  if (!value.startsWith(TEXT_V1)) return value;
  const [ivB64, tagB64, ctB64] = value.slice(TEXT_V1.length).split(':');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    keyFor(LEGACY_KEY_ID),
    Buffer.from(ivB64, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64 ?? '', 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** True when the value is already encrypted with the active key. */
export function isCurrentText(value: string): boolean {
  return value.startsWith(ACTIVE_TEXT_PREFIX);
}

export function encryptBuffer(plain: Buffer, context: EncryptionContext): Buffer {
  const keyId = Buffer.from(ACTIVE_KEY_ID, 'latin1');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(ACTIVE_KEY_ID), iv);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([
    BINARY_V2,
    Buffer.from([keyId.length]),
    keyId,
    iv,
    cipher.getAuthTag(),
    ciphertext,
  ]);
}

export function decryptBuffer(
  value: Buffer,
  context: EncryptionContext,
  options?: DecryptOptions,
): Buffer {
  if (value.subarray(0, BINARY_V2.length).equals(BINARY_V2)) {
    const idStart = BINARY_V2.length + 1;
    const ivStart = idStart + value[BINARY_V2.length];
    const keyId = value.subarray(idStart, ivStart).toString('latin1');
    const decipher = createDecipheriv('aes-256-gcm', keyFor(keyId), value.subarray(ivStart, ivStart + 12));
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(value.subarray(ivStart + 12, ivStart + 28));
    return Buffer.concat([decipher.update(value.subarray(ivStart + 28)), decipher.final()]);
  }

  assertLegacyAllowed(options, context);
  if (!value.subarray(0, BINARY_V1.length).equals(BINARY_V1)) return value;
  const ivStart = BINARY_V1.length;
  const decipher = createDecipheriv(
    'aes-256-gcm',
    keyFor(LEGACY_KEY_ID),
    value.subarray(ivStart, ivStart + 12),
  );
  decipher.setAuthTag(value.subarray(ivStart + 12, ivStart + 28));
  return Buffer.concat([decipher.update(value.subarray(ivStart + 28)), decipher.final()]);
}

/** True when the buffer is already encrypted with the active key. */
export function isCurrentBuffer(value: Buffer): boolean {
  if (!value.subarray(0, BINARY_V2.length).equals(BINARY_V2)) return false;
  const idStart = BINARY_V2.length + 1;
  const keyId = value.subarray(idStart, idStart + value[BINARY_V2.length]).toString('latin1');
  return keyId === ACTIVE_KEY_ID;
}

export function encryptCitations<T extends { text: string }>(
  citations: T[] | null | undefined,
  context: EncryptionContext,
): T[] {
  if (!citations) return [];
  return citations.map((c) => ({ ...c, text: encryptText(c.text, context) }));
}

export function decryptCitations<T extends { text: string }>(
  citations: T[] | null | undefined,
  context: EncryptionContext,
  options?: DecryptOptions,
): T[] | null {
  if (!citations) return null;
  return citations.map((c) => ({ ...c, text: decryptText(c.text, context, options) }));
}
