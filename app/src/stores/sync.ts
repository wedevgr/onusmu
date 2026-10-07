import { create } from 'zustand';
import type { OutboxEntry } from '../lib/outbox';

interface SyncState {
  entries: OutboxEntry[];
  uploading: boolean;
  hydrated: boolean;
}

interface SyncActions {
  hydrate: (entries: OutboxEntry[]) => void;
  setUploading: (uploading: boolean) => void;
}

export const useSyncStore = create<SyncState & SyncActions>((set) => ({
  entries: [],
  uploading: false,
  hydrated: false,
  hydrate: (entries) => set({ entries, hydrated: true }),
  setUploading: (uploading) => set({ uploading }),
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
