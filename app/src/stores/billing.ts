import { create } from 'zustand';
import { api } from '../api/client';
import type { BillingResponse, PlanId } from '../api/types';
import { listEntries } from '../lib/outbox';
import { formatDurationHuman } from '../lib/time';

interface BillingState {
  status: BillingResponse | null;
}

interface BillingActions {
  /** Fetches the latest plan and usage. On failure keeps (and returns) the last known status. */
  refresh: () => Promise<BillingResponse | null>;
  clear: () => void;
}

export const useBillingStore = create<BillingState & BillingActions>((set, get) => ({
  status: null,
  refresh: async () => {
    try {
      const status = await api.getBilling();
      set({ status });
      return status;
    } catch {
      return get().status;
    }
  },
  clear: () => set({ status: null }),
}));

export const PLAN_NAMES: Record<PlanId, string> = {
  free: 'Δωρεάν',
  plus: 'Plus',
  unlimited: 'Unlimited',
};

function periodLabel(status: BillingResponse): string {
  return status.period === 'day' ? 'σήμερα' : 'αυτόν τον μήνα';
}

export function usageLine(status: BillingResponse): string {
  if (status.limitSeconds === null) return 'Απεριόριστη καταγραφή';
  return `${formatDurationHuman(status.usedSeconds)} από ${formatDurationHuman(status.limitSeconds)} ${periodLabel(status)}`;
}

export function remainingLine(status: BillingResponse): string | null {
  if (status.remainingSeconds === null) return null;
  if (status.remainingSeconds <= 0) return `Έφτασες το όριο καταγραφής για ${periodLabel(status)}`;
  return `Απομένουν ${formatDurationHuman(status.remainingSeconds)} ${periodLabel(status)}`;
}

export function limitReachedMessage(status: BillingResponse): string {
  const limit = status.limitSeconds === null ? '' : ` (${formatDurationHuman(status.limitSeconds)})`;
  return `Έφτασες το όριο καταγραφής του πλάνου σου για ${periodLabel(status)}${limit}.`;
}

/**
 * How long the user may still record, or null when there is no limit (or it is unknown,
 * in which case the server still enforces it). Chunks recorded in this period that are
 * still waiting to upload are not in the server's count yet, so they are subtracted here.
 */
export async function remainingRecordingMs(status: BillingResponse | null): Promise<number | null> {
  if (!status || status.remainingSeconds === null) return null;
  const periodStartMs = new Date(status.periodStart).getTime();
  const entries = await listEntries();
  const pendingMs = entries
    .filter((entry) => entry.lastError === undefined)
    .filter((entry) => new Date(entry.startedAt).getTime() >= periodStartMs)
    .reduce(
      (sum, entry) => sum + (new Date(entry.endedAt).getTime() - new Date(entry.startedAt).getTime()),
      0,
    );
  return Math.max(0, status.remainingSeconds * 1000 - pendingMs);
}
