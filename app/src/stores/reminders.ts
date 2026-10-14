import { create } from 'zustand';
import { api } from '../api/client';
import type { Reminder, UpdateReminderRequest } from '../api/types';
import {
  cancelReminderNotifications,
  ensureNotificationPermission,
  scheduleReminderNotifications,
} from '../lib/notifications';

interface RemindersState {
  reminders: Reminder[];
  loaded: boolean;
  error: string | null;
}

interface RemindersActions {
  refresh: () => Promise<void>;
  create: (text: string, dueAt: string | null) => Promise<void>;
  update: (id: string, body: UpdateReminderRequest) => Promise<void>;
  remove: (id: string) => Promise<void>;
  clear: () => void;
}

function sortReminders(list: Reminder[]): Reminder[] {
  return [...list].sort((a, b) => {
    if (a.dueAt === null && b.dueAt === null) return b.createdAt.localeCompare(a.createdAt);
    if (a.dueAt === null) return 1;
    if (b.dueAt === null) return -1;
    return a.dueAt.localeCompare(b.dueAt);
  });
}

export const useRemindersStore = create<RemindersState & RemindersActions>((set, get) => {
  const apply = (reminders: Reminder[]): void => {
    set({ reminders: sortReminders(reminders) });
    void scheduleReminderNotifications(reminders).catch(() => undefined);
  };

  const replace = (reminder: Reminder): void => {
    const others = get().reminders.filter((item) => item.id !== reminder.id);
    apply(reminder.status === 'dismissed' ? others : [...others, reminder]);
  };

  // Ask for notification permission the first time a reminder gets a time.
  const askIfTimed = async (dueAt: string | null | undefined): Promise<void> => {
    if (dueAt) await ensureNotificationPermission().catch(() => false);
  };

  return {
    reminders: [],
    loaded: false,
    error: null,

    refresh: async () => {
      try {
        const { reminders } = await api.listReminders();
        set({ loaded: true, error: null });
        apply(reminders);
      } catch (e) {
        set({ loaded: true, error: e instanceof Error ? e.message : 'Δεν φορτώθηκαν οι υπενθυμίσεις.' });
      }
    },

    create: async (text, dueAt) => {
      await askIfTimed(dueAt);
      replace(await api.createReminder({ text, dueAt }));
    },

    update: async (id, body) => {
      const current = get().reminders.find((item) => item.id === id);
      if (body.status === 'pending') await askIfTimed(body.dueAt ?? current?.dueAt);
      else await askIfTimed(body.dueAt);
      replace(await api.updateReminder(id, body));
    },

    remove: async (id) => {
      await api.deleteReminder(id);
      apply(get().reminders.filter((item) => item.id !== id));
    },

    clear: () => {
      set({ reminders: [], loaded: false, error: null });
      void cancelReminderNotifications().catch(() => undefined);
    },
  };
});

export const selectSuggested = (state: RemindersState): Reminder[] =>
  state.reminders.filter((item) => item.status === 'suggested');

export const selectOpen = (state: RemindersState): Reminder[] =>
  state.reminders.filter((item) => item.status === 'pending');

export const selectDone = (state: RemindersState): Reminder[] =>
  state.reminders.filter((item) => item.status === 'done');
