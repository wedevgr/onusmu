import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, ApiError } from '../api/client';
import { useSyncStore } from '../stores/sync';
import {
  enqueue,
  incrementAttempts,
  listEntries,
  markFailed,
  remove,
  type EnqueueInput,
  type OutboxEntry,
} from './outbox';

const SESSIONS_KEY = 'aimemory.sessions.v1';
const SYNC_INTERVAL_MS = 20000;
const BACKOFF_BASE_MS = 15000;
const MAX_ATTEMPTS = 8;

interface LocalSession {
  localId: string;
  startedAt: string;
}

let processing = false;
let timer: ReturnType<typeof setInterval> | null = null;

async function readLocalSessions(): Promise<LocalSession[]> {
  try {
    const raw = await AsyncStorage.getItem(SESSIONS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as LocalSession[]) : [];
  } catch {
    return [];
  }
}

export async function rememberSession(localId: string, startedAt: string): Promise<void> {
  const sessions = await readLocalSessions();
  if (sessions.some((s) => s.localId === localId)) return;
  sessions.push({ localId, startedAt });
  await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions.slice(-100)));
}

export async function hydrateOutbox(): Promise<void> {
  const entries = await listEntries();
  useSyncStore.getState().hydrate(entries);
}

/** Called by the recorder for every finished 45s segment. Never throws. */
export async function enqueueChunk(input: EnqueueInput): Promise<void> {
  try {
    await enqueue(input);
    await hydrateOutbox();
  } finally {
    void processOutbox();
  }
}

async function ensureRemoteSession(entry: OutboxEntry): Promise<void> {
  const sessions = await readLocalSessions();
  const known = sessions.find((s) => s.localId === entry.sessionLocalId);
  const startedAt = known?.startedAt ?? entry.startedAt;
  await api.createSession({ clientId: entry.sessionLocalId, startedAt });
}

async function processEntry(entry: OutboxEntry): Promise<'ok' | 'retry-later' | 'done'> {
  try {
    await ensureRemoteSession(entry);
    const fileName = entry.fileUri.split('/').pop() ?? `${entry.sessionLocalId}_${entry.chunkIndex}.m4a`;
    await api.uploadChunk({
      sessionId: entry.sessionLocalId,
      chunkIndex: entry.chunkIndex,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
      fileUri: entry.fileUri,
      fileName,
    });
    await remove(entry.id);
    return 'ok';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = err instanceof ApiError ? err.status : 0;
    if (status >= 400 && status < 500 && status !== 401) {
      // Permanent failure (e.g. rejected file): keep the file, surface the error.
      await markFailed(entry.id, message);
      return 'ok';
    }
    const attempts = entry.attempts + 1;
    await incrementAttempts(entry.id);
    if (attempts >= MAX_ATTEMPTS) {
      await markFailed(entry.id, message);
      return 'ok';
    }
    return 'retry-later';
  }
}

export async function processOutbox(): Promise<void> {
  if (processing) return;
  processing = true;
  useSyncStore.getState().setUploading(true);
  try {
    for (;;) {
      const entries = await listEntries();
      const entry = entries.find((e) => e.lastError === undefined);
      if (!entry) break;
      const outcome = await processEntry(entry);
      await hydrateOutbox();
      if (outcome === 'retry-later') break; // preserve order, back off, retry via loop/foreground
      await delay(BACKOFF_BASE_MS); // gentle pacing between uploads
    }
  } catch {
    // Sync must never crash the app; next interval/foreground retries.
  } finally {
    processing = false;
    useSyncStore.getState().setUploading(false);
  }
}

export async function stopRemoteSession(localId: string, endedAt: string): Promise<void> {
  try {
    await api.stopSession(localId, { endedAt });
  } catch {
    // Best effort: the server also derives ended_at from chunk timestamps.
  }
}

export function startSyncLoop(): void {
  stopSyncLoop();
  void hydrateOutbox().then(() => processOutbox());
  timer = setInterval(() => {
    void processOutbox();
  }, SYNC_INTERVAL_MS);
}

export function stopSyncLoop(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
