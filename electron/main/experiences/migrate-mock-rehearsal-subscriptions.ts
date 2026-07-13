import type { MockRehearsalBrokerSnapshot } from "@electron/shared/instruments/mock-rehearsal";

/**
 * V2: Session input subscriptions are managed by SessionInputSubscriptionRepo,
 * not session_signal_sources. Mock-rehearsal attachment uses the V2 catalog
 * (source definitions + session_input_subscriptions). This function is a
 * no-op stub kept for call-site compatibility; migration is driven by
 * provisionDefaultInputs at session creation time.
 */
export function migrateEligibleSessionsToMockRehearsal(_deps: {
  sessions: Array<{ id: string; experienceId: string }>;
  listAssignments: (sessionId: string) => Array<{ brokerAccountId: string }>;
  brokerAccounts: readonly MockRehearsalBrokerSnapshot[];
  syncTicker: (ticker: string) => void;
}): string[] {
  return [];
}
