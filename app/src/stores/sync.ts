import { create } from 'zustand';
import type { OutboxEntry } from '../lib/outbox';

interface SyncState {
  entries: OutboxEntry[];
  uploading: boolean;
  hydrated: boolean;
  // When a chunk last reached the server; screens reload on it.
  lastUploadAt: number;
}

interface SyncActions {
  hydrate: (entries: OutboxEntry[]) => void;
  setUploading: (uploading: boolean) => void;
  markUploaded: () => void;
}

export const useSyncStore = create<SyncState & SyncActions>((set) => ({
  entries: [],
  uploading: false,
  hydrated: false,
  lastUploadAt: 0,
  hydrate: (entries) => set({ entries, hydrated: true }),
  setUploading: (uploading) => set({ uploading }),
  markUploaded: () => set({ lastUploadAt: Date.now() }),
}));

export interface SyncStatus {
  pending: number;
  uploading: boolean;
  failed: number;
}

export function selectSyncStatus(state: SyncState): SyncStatus {
  let pending = 0;
  let failed = 0;
  for (const entry of state.entries) {
    if (entry.lastError !== undefined) failed += 1;
    else pending += 1;
  }
  return { pending, uploading: state.uploading, failed };
}
