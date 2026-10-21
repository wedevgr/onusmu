import { AppState } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import type { BillingResponse, PlanId } from '../api/types';
import { config } from '../config';
import { useBillingStore } from '../stores/billing';

const PLAN_ORDER: PlanId[] = ['free', 'starter', 'plus', 'pro', 'unlimited'];

/**
 * Whether the app can offer a plan change. Plans are bought on the website; one bought in
 * an app store can only be changed there, and Unlimited has nothing above it.
 */
export function canUpgrade(status: BillingResponse | null): boolean {
  if (!status || !config.websiteUrl) return false;
  if (status.provider === 'app_store' || status.provider === 'play_store') return false;
  return status.plan !== 'unlimited';
}

/**
 * Opens the website's plans (account page), with the next plan up highlighted. The user signs
 * in there with the same account; the plan is re-read when they come back to the app.
 */
export async function openPlans(status: BillingResponse | null): Promise<void> {
  const next = status ? PLAN_ORDER[PLAN_ORDER.indexOf(status.plan) + 1] : undefined;
  const url = `${config.websiteUrl}/account${next ? `?plan=${next}` : ''}#plans-section`;

  // iOS resolves when the sheet is closed. Android resolves right away ('opened') and the
  // app comes back to the foreground when the browser tab is closed.
  const refresh = (): void => {
    subscription.remove();
    void useBillingStore.getState().refresh();
  };
  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') refresh();
  });
  try {
    const result = await WebBrowser.openBrowserAsync(url);
    if (result.type !== 'opened') refresh();
  } catch {
    subscription.remove();
  }
}
