import { requireExperience } from "./index";
import {
  MOCK_REHEARSAL_SIGNAL_SOURCE_ID,
  resolveMockRehearsalTickerFromBrokers,
  sessionEligibleForMockRehearsal,
  type MockRehearsalBrokerSnapshot,
} from "@electron/shared/instruments/mock-rehearsal";
import { signalSourceId } from "@electron/shared/instruments/session-input-model";
import type { SignalSourcesRepo } from "../services/signals/repos/signal-sources-repo";

export function migrateEligibleSessionsToMockRehearsal(deps: {
  sessions: Array<{ id: string; experienceId: string }>;
  listAssignments: (sessionId: string) => Array<{ brokerAccountId: string }>;
  brokerAccounts: readonly MockRehearsalBrokerSnapshot[];
  signalSources: SignalSourcesRepo;
  syncTicker: (ticker: string) => void;
}): string[] {
  const migratedSessionIds: string[] = [];

  for (const session of deps.sessions) {
    let experience;
    try {
      experience = requireExperience(session.experienceId);
    } catch {
      continue;
    }

    const brokerAssignmentIds = deps
      .listAssignments(session.id)
      .map((assignment) => assignment.brokerAccountId);
    if (
      !sessionEligibleForMockRehearsal({
        experience: experience.capabilities,
        brokerAccounts: deps.brokerAccounts,
        brokerAssignmentIds,
      })
    ) {
      continue;
    }

    const subscribedSourceIds =
      deps.signalSources.subscribedSourceIdsForSession(session.id);
    const alreadyOnMockRehearsal = subscribedSourceIds.includes(
      MOCK_REHEARSAL_SIGNAL_SOURCE_ID,
    );

    const ticker = resolveMockRehearsalTickerFromBrokers(
      deps.brokerAccounts,
      brokerAssignmentIds,
    );
    deps.syncTicker(ticker);

    if (alreadyOnMockRehearsal) {
      continue;
    }

    // Session is on mock rehearsal candidate if ALL subscribed sources are
    // experience-owned signal sources for this experience.
    const experienceSignalSourceIds = new Set(
      experience.signals.map((s) => signalSourceId(session.experienceId, s.id)),
    );
    const onlyExperienceSources =
      subscribedSourceIds.length > 0 &&
      subscribedSourceIds.every((id) => experienceSignalSourceIds.has(id));
    if (!onlyExperienceSources) {
      continue;
    }

    deps.signalSources.replaceSessionSubscriptions(session.id, [
      MOCK_REHEARSAL_SIGNAL_SOURCE_ID,
    ]);
    migratedSessionIds.push(session.id);
  }

  return migratedSessionIds;
}
