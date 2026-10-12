import { readFileSync } from 'node:fs';
import type { ConnectionOptions } from 'node:tls';

let warned = false;

/**
 * TLS settings for Postgres connections.
 *
 * With DATABASE_CA_CERT set (a path to a .crt/.pem file, or the PEM text
 * itself) the server certificate is verified against that CA. Without it the
 * connection is still encrypted but the server's identity is not checked.
 */
export function dbSsl(): ConnectionOptions {
  const raw = (process.env.DATABASE_CA_CERT ?? '').trim();
  if (!raw) {
    if (!warned) {
      warned = true;
      console.warn(
        '[db] DATABASE_CA_CERT is not set: the database connection is encrypted but the server certificate is NOT verified.',
      );
    }
    return { rejectUnauthorized: false };
  }
  const ca = raw.includes('BEGIN CERTIFICATE') ? raw.replace(/\\n/g, '\n') : readFileSync(raw, 'utf8');
  return { ca, rejectUnauthorized: true };
}
