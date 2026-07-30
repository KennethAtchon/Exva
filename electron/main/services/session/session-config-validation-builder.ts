import type { InstrumentClass } from "@/lib/types";
import { requireExperience } from "../../experiences/index";
import type { ExperienceSupportState } from "../../experiences/types";
import type { BrokerAccountsRepo } from "../../db/repositories/brokers/broker-accounts-repo";
import {
  validateSessionConfiguration,
  type ConfigValidationIssue,
  type SessionConfigValidationInput,
} from "./session-config-validation";
import type { SessionWriteInput } from "./write-service";

/** Sentinel sessions are named *-SENTINEL or *-INTEGRATION-SENTINEL (Solution 09). */
export function isSentinelSessionName(name: string): boolean {
  const trimmed = name.trim().toUpperCase();
  return trimmed.endsWith("-SENTINEL") || trimmed.includes("INTEGRATION-SENTINEL");
}

export function buildSessionConfigValidationInput(
  input: SessionWriteInput,
  ctx: {
    instrumentClasses: InstrumentClass[];
    brokerAccounts: BrokerAccountsRepo;
    selectedTimeframe?: string | null;
    historyBarsActual?: number | null;
    historyBarsRequired?: number | null;
    duplicateScheduleGroup?: boolean;
  },
): SessionConfigValidationInput {
  const experienceId = input.experienceId ?? "edgar-catalyst";
  const experience = requireExperience(experienceId);
  const supportState: ExperienceSupportState =
    experience.supportState ?? "available";
  const brokers = ctx.brokerAccounts.list();
  const selectedIds = new Set(
    input.brokerAssignments.map((a) => a.brokerAccountId),
  );
  const hasCertifiedPaperBroker = brokers.some(
    (broker) =>
      selectedIds.has(broker.id) &&
      broker.mode === "paper" &&
      ctx.instrumentClasses.every((cls) =>
        broker.supportedInstrumentClasses.includes(cls),
      ),
  );

  return {
    experienceId,
    supportState,
    blockerMessage: experience.blockerMessage ?? null,
    acceptedInstrumentClasses: [],
    selectedInstrumentClasses: ctx.instrumentClasses,
    supportedTimeframes: [],
    selectedTimeframe: ctx.selectedTimeframe ?? null,
    hasCertifiedPaperBroker,
    historyBarsActual: ctx.historyBarsActual ?? null,
    historyBarsRequired: ctx.historyBarsRequired ?? null,
    duplicateScheduleGroup: ctx.duplicateScheduleGroup ?? false,
    isSentinelSession: isSentinelSessionName(input.name),
    executionMode: input.executionMode,
  };
}

export function validateSessionWriteConfiguration(
  input: SessionWriteInput,
  ctx: Parameters<typeof buildSessionConfigValidationInput>[1],
): ConfigValidationIssue[] {
  return validateSessionConfiguration(
    buildSessionConfigValidationInput(input, ctx),
  );
}
