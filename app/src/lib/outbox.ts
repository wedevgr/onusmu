import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';

const STORAGE_KEY = 'aimemory.outbox.v1';
const OUTBOX_DIR = `${FileSystem.documentDirectory ?? ''}outbox/`;

export interface OutboxEntry {
  id: string;
  sessionLocalId: string;
  chunkIndex: number;
  fileUri: string;
  startedAt: string;
  endedAt: string;
  attempts: number;
  lastError?: string;
  enqueuedAt: string;
}

export interface EnqueueInput {
  sessionLocalId: string;
  chunkIndex: number;
  uri: string;
  startedAt: string;
  endedAt: string;
}

function isOutboxEntry(value: unknown): value is OutboxEntry {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.sessionLocalId === 'string' &&
    typeof record.chunkIndex === 'number' &&
    typeof record.fileUri === 'string' &&
    typeof record.startedAt === 'string' &&
    typeof record.endedAt === 'string' &&
    typeof record.attempts === 'number' &&
    typeof record.enqueuedAt === 'string'
  );
}

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(OUTBOX_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(OUTBOX_DIR, { intermediates: true });
  }
}

export async function listEntries(): Promise<OutboxEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isOutboxEntry);
  } catch {
    return [];
  }
}

async function saveEntries(entries: OutboxEntry[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

async function updateEntries(
  mutator: (entries: OutboxEntry[]) => OutboxEntry[],
): Promise<OutboxEntry[]> {
  const entries = await listEntries();
  const next = mutator(entries);
  await saveEntries(next);
  return next;
}

async function deleteFile(fileUri: string): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(fileUri);
    if (info.exists) {
      await FileSystem.deleteAsync(fileUri, { idempotent: true });
    }
  } catch {
    // Never crash the outbox because a file could not be removed.
  }
}

export async function enqueue(input: EnqueueInput): Promise<OutboxEntry> {
  await ensureDir();
  const id = Crypto.randomUUID();
  const enqueuedAt = new Date().toISOString();
  const fileName = `${input.sessionLocalId}_${input.chunkIndex}.m4a`;
  const destination = `${OUTBOX_DIR}${fileName}`;

  try {
    await FileSystem.moveAsync({ from: input.uri, to: destination });
  } catch {
    await FileSystem.copyAsync({ from: input.uri, to: destination });
    await deleteFile(input.uri);
  }

  const entry: OutboxEntry = {
    id,
    sessionLocalId: input.sessionLocalId,
    chunkIndex: input.chunkIndex,
    fileUri: destination,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    attempts: 0,
    enqueuedAt,
  };

  await updateEntries((entries) => [...entries, entry]);
  return entry;
}

export async function remove(id: string): Promise<OutboxEntry[]> {
  const entries = await listEntries();
  const target = entries.find((entry) => entry.id === id);
  if (target) {
    await deleteFile(target.fileUri);
  }
  return updateEntries((current) => current.filter((entry) => entry.id !== id));
}

export async function markFailed(id: string, error: string): Promise<OutboxEntry[]> {
  return updateEntries((entries) =>
    entries.map((entry) => (entry.id === id ? { ...entry, lastError: error } : entry)),
  );
}

export async function incrementAttempts(id: string): Promise<OutboxEntry[]> {
  return updateEntries((entries) =>
    entries.map((entry) => (entry.id === id ? { ...entry, attempts: entry.attempts + 1 } : entry)),
  );
}

export async function clearAll(): Promise<void> {
  const entries = await listEntries();
  await Promise.all(entries.map((entry) => deleteFile(entry.fileUri)));
  await saveEntries([]);
}
