import { create } from 'zustand';

interface SettingsState {
  keepAudio: boolean;
  loaded: boolean;
}

interface SettingsActions {
  setKeepAudio: (value: boolean) => void;
  setLoaded: (value: boolean) => void;
}

export const useSettingsStore = create<SettingsState & SettingsActions>((set) => ({
  keepAudio: false,
  loaded: false,
  setKeepAudio: (value) => set({ keepAudio: value }),
  setLoaded: (value) => set({ loaded: value }),
}));
