import type { SignalSourceType } from "@electron/shared/domain";
import type { ExperienceCapabilities } from "@electron/shared/domain/experience";
import {
  DEFAULT_MOCK_SCENARIO_KIND,
  type MockScenarioKind,
  MOCK_SCENARIO_PRIMARY_SYMBOLS,
} from "@electron/shared/domain/mock-scenario";
import { experienceSignalSourceId } from "./session-input-model";

export const MOCK_REHEARSAL_SIGNAL_SOURCE_ID = "mock-rehearsal-signal";

export type MockRehearsalBrokerSnapshot = {
  id: string;
  brokerType: string;
  mockScenarioKind?: MockScenarioKind | null;
};

export function resolveMockRehearsalTicker(
  mockScenarioKind:
    | MockScenarioKind
    | null
    | undefined = DEFAULT_MOCK_SCENARIO_KIND,
): string {
  const kind = mockScenarioKind ?? DEFAULT_MOCK_SCENARIO_KIND;
  return (
    MOCK_SCENARIO_PRIMARY_SYMBOLS[kind][0] ??
    MOCK_SCENARIO_PRIMARY_SYMBOLS[DEFAULT_MOCK_SCENARIO_KIND][0] ??
    "NVDA"
  );
}

export function experienceSupportsMockRehearsal(
  capabilities: Pick<
    ExperienceCapabilities,
    "signalSourceTypes" | "mockRehearsalEligible"
  >,
): boolean {
  return (
    capabilities.mockRehearsalEligible === true ||
    capabilities.signalSourceTypes.includes("mock")
  );
}

export function sessionEligibleForMockRehearsal(input: {
  experience: Pick<
    ExperienceCapabilities,
    "signalSourceTypes" | "mockRehearsalEligible"
  >;
  brokerAccounts: readonly MockRehearsalBrokerSnapshot[];
  brokerAssignmentIds: readonly string[];
}): boolean {
  if (!experienceSupportsMockRehearsal(input.experience)) {
    return false;
  }
  if (input.brokerAssignmentIds.length === 0) {
    return false;
  }
  const assigned = input.brokerAssignmentIds.flatMap((brokerAccountId) => {
    const broker = input.brokerAccounts.find(
      (account) => account.id === brokerAccountId,
    );
    return broker ? [broker] : [];
  });
  if (assigned.length !== input.brokerAssignmentIds.length) {
    return false;
  }
  return assigned.every((broker) => broker.brokerType === "mock");
}

export function sessionSubscribedToMockRehearsal(
  subscribedSources: ReadonlyArray<{
    id: string;
    type: SignalSourceType;
  }>,
): boolean {
  return subscribedSources.some(
    (source) =>
      source.type === "mock" && source.id === MOCK_REHEARSAL_SIGNAL_SOURCE_ID,
  );
}

export function resolveMockRehearsalTickerFromBrokers(
  brokerAccounts: readonly MockRehearsalBrokerSnapshot[],
  brokerAssignmentIds: readonly string[],
): string {
  const firstAssigned = brokerAssignmentIds
    .map((id) => brokerAccounts.find((account) => account.id === id))
    .find((broker): broker is MockRehearsalBrokerSnapshot => Boolean(broker));
  return resolveMockRehearsalTicker(firstAssigned?.mockScenarioKind);
}

export function resolvePreferredSubscribedSourceId(input: {
  experience: Pick<
    ExperienceCapabilities,
    "signalSourceTypes" | "mockRehearsalEligible"
  > & {
    id: string;
  };
  compatibleSourceIds: readonly string[];
  brokerAccounts: readonly MockRehearsalBrokerSnapshot[];
  brokerAssignmentIds: readonly string[];
}): string | null {
  if (
    sessionEligibleForMockRehearsal({
      experience: input.experience,
      brokerAccounts: input.brokerAccounts,
      brokerAssignmentIds: input.brokerAssignmentIds,
    }) &&
    input.compatibleSourceIds.includes(MOCK_REHEARSAL_SIGNAL_SOURCE_ID)
  ) {
    return MOCK_REHEARSAL_SIGNAL_SOURCE_ID;
  }

  const experienceSourceId = experienceSignalSourceId(input.experience.id);
  if (input.compatibleSourceIds.includes(experienceSourceId)) {
    return experienceSourceId;
  }

  return input.compatibleSourceIds[0] ?? null;
}

export function shouldAutoSwitchSignalSubscription(input: {
  preferredSourceId: string | null;
  subscribedSourceIds: readonly string[];
}): boolean {
  if (!input.preferredSourceId) return false;
  if (input.subscribedSourceIds[0] === input.preferredSourceId) return false;
  return (
    input.preferredSourceId === MOCK_REHEARSAL_SIGNAL_SOURCE_ID ||
    input.subscribedSourceIds.includes(MOCK_REHEARSAL_SIGNAL_SOURCE_ID)
  );
}
