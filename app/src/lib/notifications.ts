import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { Reminder } from '../api/types';

const CHANNEL_ID = 'reminders';

// Reminders that come due while the app is open still show as a banner.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let channelReady: Promise<void> | null = null;

function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  channelReady ??= Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Υπενθυμίσεις',
    importance: Notifications.AndroidImportance.HIGH,
  }).then(() => undefined);
  return channelReady;
}

/** Asks for permission only if it has not been decided yet. Returns whether it is granted. */
export async function ensureNotificationPermission(): Promise<boolean> {
  await ensureChannel();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

/**
 * Makes the phone's scheduled notifications match the reminders: one per open reminder
 * with a time still ahead. Scheduled locally, so they fire even without a connection.
 */
export async function scheduleReminderNotifications(reminders: Reminder[]): Promise<void> {
  const { granted } = await Notifications.getPermissionsAsync();
  await Notifications.cancelAllScheduledNotificationsAsync();
  if (!granted) return;
  await ensureChannel();

  const now = Date.now();
  for (const reminder of reminders) {
    if (reminder.status !== 'pending' || reminder.dueAt === null) continue;
    const date = new Date(reminder.dueAt);
    if (date.getTime() <= now) continue;
    await Notifications.scheduleNotificationAsync({
      identifier: reminder.id,
      content: {
        title: 'Υπενθύμιση',
        body: reminder.text,
        data: { reminderId: reminder.id },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date,
        channelId: CHANNEL_ID,
      },
    });
  }
}

export async function cancelReminderNotifications(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}
