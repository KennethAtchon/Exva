import type { InstrumentClass } from "@/lib/types";
import type { SignalEvent } from "@electron/shared/domain";
import {
  extractSignalInstrumentClass,
  signalSourceEmitsClass,
} from "@electron/shared/domain/signal-source-capabilities";
import type { SignalDeadLetterReason } from "@electron/shared/domain/signal-dead-letters";
import { AppError } from "@electron/shared/infra/errors";
import { requireExperience } from "../../experiences/index";
import type { BrokerAccountsRepo } from "../../db/repositories/brokers/broker-accounts-repo";
import type { BrokerRoutingService } from "../broker/broker-routing-service";

export type SignalDeliveryGateResult =
  | { ok: true; brokerAccountId: string | null }
  | {
      ok: false;
      reason: SignalDeadLetterReason;
      detail: Record<string, unknown>;
    };

export function evaluateSignalDeliveryGate(input: {
  sessionId: string;
  experienceId: string;
  signal: SignalEvent;
  brokerAssignments: string[];
  brokerAccounts: BrokerAccountsRepo;
  brokerRouting: BrokerRoutingService;
}): SignalDeliveryGateResult {
  const experience = requireExperience(input.experienceId);
  const capabilities = experience.capabilities;

  if (!capabilities.signalSourceTypes.includes(input.signal.sourceType)) {
    return {
      ok: false,
      reason: "unsupported_by_experience",
      detail: {
        sourceType: input.signal.sourceType,
        allowedSourceTypes: capabilities.signalSourceTypes,
      },
    };
  }

  const instrumentClass = extractSignalInstrumentClass(input.signal);
  if (!instrumentClass) {
    return {
      ok: false,
      reason: "unsupported_by_experience",
      detail: {
        field: "instrumentClass",
        message: "Signal is missing a normalized instrument class.",
      },
    };
  }

  if (!capabilities.instrumentClasses.includes(instrumentClass)) {
    return {
      ok: false,
      reason: "unsupported_by_experience",
      detail: {
        instrumentClass,
        allowedInstrumentClasses: capabilities.instrumentClasses,
      },
    };
  }

  if (
    !signalSourceEmitsClass(
      input.signal.sourceType,
      input.signal,
      instrumentClass,
    )
  ) {
    return {
      ok: false,
      reason: "unsupported_by_signal_source",
      detail: {
        sourceType: input.signal.sourceType,
        instrumentClass,
      },
    };
  }

  const supportingBrokers = input.brokerAssignments.filter(
    (brokerAccountId) => {
      const account = input.brokerAccounts.find(brokerAccountId);
      return (
        account?.supportedInstrumentClasses.includes(instrumentClass) ?? false
      );
    },
  );
  if (supportingBrokers.length === 0) {
    return {
      ok: false,
      reason: "unsupported_by_assigned_broker",
      detail: {
        instrumentClass,
        brokerAssignments: input.brokerAssignments,
      },
    };
  }

  try {
    const brokerAccountId = input.brokerRouting.resolveBrokerAccountId(
      input.sessionId,
      instrumentClass as InstrumentClass,
    );
    return { ok: true, brokerAccountId };
  } catch (error) {
    if (
      error instanceof AppError &&
      (error.code === "NO_BROKER" || error.code === "ROUTING_AMBIGUOUS")
    ) {
      return {
        ok: false,
        reason: "no_compatible_broker_route",
        detail: {
          instrumentClass,
          errorCode: error.code,
          ...(typeof error.details === "object" && error.details
            ? error.details
            : {}),
        },
      };
    }
    throw error;
  }
}
