import { api } from '../api/client';
import { scheduleBriefings } from './notifications';

let running: Promise<void> | null = null;

/**
 * Fetches the next mornings' briefings and schedules them, or clears them when the user turned
 * the briefing off. Calls made while one is running share it. Best effort: an older server
 * without briefings, or no connection, leaves the schedule as it was.
 */
export function refreshBriefings(): Promise<void> {
  running ??= (async () => {
    try {
      const settings = await api.getSettings();
      if (settings.briefingEnabled === undefined) return;
      if (!settings.briefingEnabled) {
        await scheduleBriefings([], null);
        return;
      }
      const { briefings } = await api.getBriefings();
      await scheduleBriefings(briefings, settings.briefingTime ?? '08:30');
    } catch {
      // Keep what is scheduled; the next refresh tries again.
    } finally {
      running = null;
    }
  })();
  return running;
}
