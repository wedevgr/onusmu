import { create } from 'zustand';

interface RecordingState {
  active: boolean;
  sessionLocalId: string | null;
  startedAt: string | null;
  chunkCount: number;
  error: string | null;
}

interface RecordingActions {
  begin: (sessionLocalId: string, startedAt: string) => void;
  incrementChunkCount: () => void;
  setError: (message: string | null) => void;
  reset: () => void;
}

export const useRecordingStore = create<RecordingState & RecordingActions>((set) => ({
  active: false,
  sessionLocalId: null,
  startedAt: null,
  chunkCount: 0,
  error: null,
  begin: (sessionLocalId, startedAt) =>
    set({ active: true, sessionLocalId, startedAt, chunkCount: 0, error: null }),
  incrementChunkCount: () => set((state) => ({ chunkCount: state.chunkCount + 1 })),
  setError: (message) => set({ error: message }),
  reset: () =>
    set({ active: false, sessionLocalId: null, startedAt: null, chunkCount: 0, error: null }),
}));
