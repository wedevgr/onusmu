import { create } from 'zustand';

interface SettingsState {
  keepAudio: boolean;
  autoReminders: boolean;
  loaded: boolean;
}

interface SettingsActions {
  setKeepAudio: (value: boolean) => void;
  setAutoReminders: (value: boolean) => void;
  setLoaded: (value: boolean) => void;
}

export const useSettingsStore = create<SettingsState & SettingsActions>((set) => ({
  keepAudio: false,
  autoReminders: false,
  loaded: false,
  setKeepAudio: (value) => set({ keepAudio: value }),
  setAutoReminders: (value) => set({ autoReminders: value }),
  setLoaded: (value) => set({ loaded: value }),
}));
