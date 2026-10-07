import * as Crypto from 'expo-crypto';
import { useRecordingStore } from '../stores/recording';
import { recorder, type RecordedChunk } from './recorder';
import { enqueueChunk, rememberSession, stopRemoteSession } from './sync';

async function handleChunk(sessionLocalId: string, chunk: RecordedChunk): Promise<void> {
  useRecordingStore.getState().incrementChunkCount();
  await enqueueChunk({
    sessionLocalId,
    chunkIndex: chunk.index,
    uri: chunk.uri,
    startedAt: chunk.startedAt,
    endedAt: chunk.endedAt,
  });
}

export async function beginRecording(): Promise<void> {
  const store = useRecordingStore.getState();
  if (store.active) return;

  const sessionLocalId = Crypto.randomUUID();
  const startedAt = new Date().toISOString();
  await rememberSession(sessionLocalId, startedAt);
  store.begin(sessionLocalId, startedAt);

  try {
    await recorder.start(
      (chunk) => {
        void handleChunk(sessionLocalId, chunk).catch(() => undefined);
      },
      (message) => useRecordingStore.getState().setError(message),
    );
  } catch (err) {
    useRecordingStore.getState().reset();
    throw err;
  }
}

export async function endRecording(): Promise<void> {
  await recorder.stop();
  const { sessionLocalId } = useRecordingStore.getState();
  const endedAt = new Date().toISOString();
  if (sessionLocalId) {
    await stopRemoteSession(sessionLocalId, endedAt);
  }
  useRecordingStore.getState().reset();
}
