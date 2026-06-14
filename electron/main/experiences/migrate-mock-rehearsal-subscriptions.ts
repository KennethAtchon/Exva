import { requireExperience } from "./index";
import {
  MOCK_REHEARSAL_SIGNAL_SOURCE_ID,
  resolveMockRehearsalTickerFromBrokers,
  sessionEligibleForMockRehearsal,
  type MockRehearsalBrokerSnapshot,
} from "@electron/shared/instruments/mock-rehearsal";
import { experienceSignalSourceId } from "@electron/shared/instruments/session-input-model";
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
    const experienceSourceId = experienceSignalSourceId(session.experienceId);
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

    const onDefaultExperienceSource =
      subscribedSourceIds.length === 1 &&
      subscribedSourceIds[0] === experienceSourceId;
    if (!onDefaultExperienceSource) {
      continue;
    }

    deps.signalSources.replaceSessionSubscriptions(session.id, [
      MOCK_REHEARSAL_SIGNAL_SOURCE_ID,
    ]);
    migratedSessionIds.push(session.id);
  }

  return migratedSessionIds;
}
