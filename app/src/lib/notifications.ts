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
  // Only reminders: the morning briefings are scheduled separately and must stay.
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((n) => !n.identifier.startsWith(BRIEFING_PREFIX))
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
  if (!granted) return;
  await ensureChannel();

  const now = Date.now();
  for (const reminder of reminders) {
    if (reminder.status !== 'pending' || reminder.dueAt === null) continue;
    // A repeating reminder gets one notification per upcoming date the server listed.
    const dates = reminder.upcoming && reminder.upcoming.length > 0 ? reminder.upcoming : [reminder.dueAt];
    for (const [index, iso] of dates.entries()) {
      await scheduleOne(reminder, index === 0 ? reminder.id : `${reminder.id}#${index}`, new Date(iso), now);
    }
  }
}

async function scheduleOne(reminder: Reminder, identifier: string, date: Date, now: number): Promise<void> {
  if (date.getTime() <= now) return;
  await Notifications.scheduleNotificationAsync({
    identifier,
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

/** Cancels everything scheduled, briefings included (on sign-out). */
export async function cancelReminderNotifications(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

export const BRIEFING_PREFIX = 'briefing-';
const BRIEFING_CHANNEL_ID = 'briefing';

/**
 * Schedules the morning briefings the server prepared, one per day at the chosen time, replacing
 * the ones scheduled before. Local notifications, so they arrive with the app closed; they are
 * refreshed whenever the app opens or reminders change.
 */
export async function scheduleBriefings(
  briefings: Array<{ date: string; title: string; body: string }>,
  time: string | null,
): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((n) => n.identifier.startsWith(BRIEFING_PREFIX))
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
  const { granted } = await Notifications.getPermissionsAsync();
  if (!granted || time === null) return;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(BRIEFING_CHANNEL_ID, {
      name: 'Πρωινή ενημέρωση',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const [hour, minute] = time.split(':').map(Number);
  const now = Date.now();
  for (const briefing of briefings) {
    const [year, month, day] = briefing.date.split('-').map(Number);
    // Phone-local time; the server's dates are in the user's timezone, which the phone reports.
    const date = new Date(year!, month! - 1, day!, hour, minute);
    if (date.getTime() <= now) continue;
    await Notifications.scheduleNotificationAsync({
      identifier: `${BRIEFING_PREFIX}${briefing.date}`,
      content: { title: briefing.title, body: briefing.body, data: { kind: 'briefing' } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date, channelId: BRIEFING_CHANNEL_ID },
    });
  }
}
