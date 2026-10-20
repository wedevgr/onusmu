import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Calendar from 'expo-calendar';
import { Platform } from 'react-native';
import type { Reminder } from '../api/types';

/**
 * Puts the reminders that have a time into the phone's calendar, in a calendar of their own
 * ("Onusmu") so they are easy to hide or remove. One way only: the app is the source and the
 * calendar mirrors it. Switched on in Settings; off by default.
 */

const ENABLED_KEY = 'onusmu.calendar.enabled';
const CALENDAR_KEY = 'onusmu.calendar.id';
// reminder id -> the event made for it and what it showed, to skip unchanged ones.
const EVENTS_KEY = 'onusmu.calendar.events';

const CALENDAR_TITLE = 'Onusmu';
const CALENDAR_COLOR = '#2E7F72';
const EVENT_MINUTES = 30;

type EventMap = Record<string, { eventId: string; signature: string }>;

export type EnableResult = 'enabled' | 'denied' | 'failed';

// Syncs run one after another, so two quick changes cannot create the same event twice.
let queue: Promise<void> = Promise.resolve();

export async function isCalendarSyncEnabled(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ENABLED_KEY)) === '1';
  } catch {
    return false;
  }
}

/** Asks for calendar access, makes the Onusmu calendar and fills it. */
export async function enableCalendarSync(reminders: Reminder[]): Promise<EnableResult> {
  try {
    const { granted } = await Calendar.requestCalendarPermissionsAsync();
    if (!granted) return 'denied';
    await ensureCalendar();
    await AsyncStorage.setItem(ENABLED_KEY, '1');
    syncCalendar(reminders, true);
    return 'enabled';
  } catch {
    return 'failed';
  }
}

/** Removes the Onusmu calendar with all its events and stops syncing. */
export async function disableCalendarSync(): Promise<void> {
  queue = queue.then(async () => {
    await AsyncStorage.multiRemove([ENABLED_KEY, EVENTS_KEY]).catch(() => undefined);
    const calendarId = await AsyncStorage.getItem(CALENDAR_KEY).catch(() => null);
    await AsyncStorage.removeItem(CALENDAR_KEY).catch(() => undefined);
    if (!calendarId) return;
    try {
      const { granted } = await Calendar.getCalendarPermissionsAsync();
      if (granted) await Calendar.deleteCalendarAsync(calendarId);
    } catch {
      // Already gone, or access was taken away; nothing left to clean.
    }
  });
  await queue;
}

/**
 * Makes the Onusmu calendar match the reminders: an event for each open one with a time.
 * complete: the list holds every reminder, so an event whose reminder is missing can go.
 */
export function syncCalendar(reminders: Reminder[], complete: boolean): void {
  queue = queue.then(() => runSync(reminders, complete)).catch(() => undefined);
}

async function runSync(reminders: Reminder[], complete: boolean): Promise<void> {
  if (!(await isCalendarSyncEnabled())) return;
  const { granted } = await Calendar.getCalendarPermissionsAsync();
  if (!granted) return;
  const calendarId = await ensureCalendar();
  const events = await readEvents();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const listed = new Set(reminders.map((r) => r.id));
  const wanted = reminders.filter((r) => r.status === 'pending' && r.dueAt !== null);
  const wantedIds = new Set(wanted.map((r) => r.id));

  for (const reminder of wanted) {
    const start = new Date(reminder.dueAt as string);
    const signature = `${reminder.text}|${start.toISOString()}`;
    const existing = events[reminder.id];
    if (existing?.signature === signature) continue;
    const details = {
      title: reminder.text,
      startDate: start,
      endDate: new Date(start.getTime() + EVENT_MINUTES * 60_000),
      timeZone,
      notes: 'Από το Onusmu',
      // The app already notifies; a calendar alarm too would ring twice.
      alarms: [],
    };
    let eventId: string | null = null;
    if (existing) {
      try {
        await Calendar.updateEventAsync(existing.eventId, details);
        eventId = existing.eventId;
      } catch {
        // Deleted in the calendar app: make it again below.
      }
    }
    if (!eventId) {
      try {
        eventId = await Calendar.createEventAsync(calendarId, details);
      } catch {
        continue;
      }
    }
    events[reminder.id] = { eventId, signature };
  }

  // Done, dismissed, without a time any more, or deleted.
  for (const [reminderId, { eventId }] of Object.entries(events)) {
    if (wantedIds.has(reminderId)) continue;
    if (!complete && !listed.has(reminderId)) continue;
    await Calendar.deleteEventAsync(eventId).catch(() => undefined);
    delete events[reminderId];
  }

  await AsyncStorage.setItem(EVENTS_KEY, JSON.stringify(events));
}

async function readEvents(): Promise<EventMap> {
  try {
    const raw = await AsyncStorage.getItem(EVENTS_KEY);
    return raw ? (JSON.parse(raw) as EventMap) : {};
  } catch {
    return {};
  }
}

/** The Onusmu calendar's id, making the calendar if it does not exist (any more). */
async function ensureCalendar(): Promise<string> {
  const saved = await AsyncStorage.getItem(CALENDAR_KEY);
  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  if (saved && calendars.some((c) => c.id === saved)) return saved;

  // Its events went with it; start the map again.
  await AsyncStorage.removeItem(EVENTS_KEY);
  const source = Platform.OS === 'ios' ? await iosSource(calendars) : undefined;
  const id =
    Platform.OS === 'ios'
      ? await Calendar.createCalendarAsync({
          title: CALENDAR_TITLE,
          color: CALENDAR_COLOR,
          entityType: Calendar.EntityTypes.EVENT,
          sourceId: source?.id,
          source,
          name: CALENDAR_TITLE,
        })
      : await Calendar.createCalendarAsync({
          title: CALENDAR_TITLE,
          color: CALENDAR_COLOR,
          entityType: Calendar.EntityTypes.EVENT,
          source: { isLocalAccount: true, name: CALENDAR_TITLE, type: 'LOCAL' },
          name: 'onusmu',
          ownerAccount: CALENDAR_TITLE,
          accessLevel: Calendar.CalendarAccessLevel.OWNER,
        });
  await AsyncStorage.setItem(CALENDAR_KEY, id);
  return id;
}

// iOS puts a new calendar in an account: the default one, else iCloud, else on the phone.
async function iosSource(calendars: Calendar.Calendar[]): Promise<Calendar.Source | undefined> {
  try {
    return (await Calendar.getDefaultCalendarAsync()).source;
  } catch {
    return (
      calendars.find((c) => c.source.name === 'iCloud')?.source ??
      calendars.find((c) => c.source.type === Calendar.SourceType.LOCAL)?.source
    );
  }
}
