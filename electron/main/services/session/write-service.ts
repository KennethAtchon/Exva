import type { InstrumentClass, WorkspaceSession } from "@/lib/types";
import {
  brokerOverlapsExperience,
  isSessionLaunchable,
  resolveSessionInstrumentClasses,
} from "@electron/shared/instruments/experience-launchability";
import { AppError } from "@electron/shared/infra/errors";
import {
  MOCK_REHEARSAL_SIGNAL_SOURCE_ID,
  resolveMockRehearsalTickerFromBrokers,
  sessionEligibleForMockRehearsal,
} from "@electron/shared/instruments/mock-rehearsal";
import { requireExperience } from "../../experiences/index";
import type { EventsRepo } from "../../db/repositories/system/events-repo";
import type { SessionRepo } from "../../db/repositories/sessions/session-repo";
import type { SessionSelectorSettingsRepo } from "../../db/repositories/sessions/session-selector-settings-repo";
import type { SessionBrokerAssignmentsRepo } from "../../db/repositories/sessions/session-broker-assignments-repo";
import type { BrokerRoutingRepo } from "../../db/repositories/brokers/broker-routing-repo";
import type { BrokerAccountsRepo } from "../../db/repositories/brokers/broker-accounts-repo";

export interface SessionWriteInput {
  name: string;
  objective: string;
  selectionMode: WorkspaceSession["selectionMode"];
  instrumentClasses?: InstrumentClass[];
  instrumentScope: string;
  defaultSearchProviderId?: string | null;
  selectorSettings: { aiPickerEnabled: boolean };
  executionMode: WorkspaceSession["executionMode"];
  brokerAssignments: Array<{ brokerAccountId: string; allocatedUsd: number }>;
  brokerOverridesByInstrumentClass?: Partial<
    Record<InstrumentClass, string | null>
  >;
  subscribedSourceIds?: string[];
  experienceId?: string;
}

type NormalizedSessionWriteInput = SessionWriteInput & {
  instrumentClasses: InstrumentClass[];
  experienceId: string;
};

export class SessionWriteService {
  constructor(
    private readonly deps: {
      sessions: SessionRepo;
      events: EventsRepo;
      selectorSettings: SessionSelectorSettingsRepo;
      assignments: SessionBrokerAssignmentsRepo;
      brokerRouting: BrokerRoutingRepo;
      brokerAccounts: BrokerAccountsRepo;
      /** Optional: live-readiness acknowledgement is invalidated on every mutation
       *  that changes broker, routing, or execution-mode context. */
      liveReadiness?: { clearAcknowledgement(sessionId: string): void };
      signals?: {
        replaceSessionSubscriptions(
          sessionId: string,
          sourceIds: string[],
        ): void;
        requiresInstrumentScopeForSourceIds(sourceIds: string[]): boolean;
        getSource(
          sourceId: string,
        ): { type: import("@electron/shared/domain").SignalSourceType } | null;
        syncMockRehearsalSignalSourceTicker?(ticker: string): void;
      };
    },
  ) {}

  create(input: SessionWriteInput): { id: string; status: "draft" } {
    const normalized = this.validate(input, { excludeSessionId: null });

    const session = this.deps.sessions.create({
      name: normalized.name.trim(),
      objective: normalized.objective.trim(),
      selectionMode: normalized.selectionMode,
      instrumentClasses: normalized.instrumentClasses,
      instrumentScope: normalized.instrumentScope.trim(),
      defaultSearchProviderId: normalized.defaultSearchProviderId ?? null,
      executionMode: normalized.executionMode,
      experienceId: normalized.experienceId,
    });
    this.deps.sessions.setFocus(session.id);
    this.applySideTables(session.id, normalized);
    this.deps.events.insert({
      session_id: session.id,
      trade_id: null,
      level: "INFO",
      agent_type: "session",
      message: `Session created: ${session.name}`,
    });
    return { id: session.id, status: "draft" };
  }

  update(id: string, input: SessionWriteInput): { savedAt: string } {
    const normalized = this.validate(input, { excludeSessionId: id });

    this.deps.sessions.updateTaskBoundary(id, {
      name: normalized.name.trim(),
      objective: normalized.objective.trim(),
      selectionMode: normalized.selectionMode,
      instrumentClasses: normalized.instrumentClasses,
      instrumentScope: normalized.instrumentScope.trim(),
      defaultSearchProviderId: normalized.defaultSearchProviderId ?? null,
      executionMode: normalized.executionMode,
    });
    this.applySideTables(id, normalized);
    return { savedAt: new Date().toISOString() };
  }

  private applySideTables(sessionId: string, input: SessionWriteInput): void {
    this.deps.selectorSettings.update(sessionId, input.selectorSettings);
    this.deps.assignments.replaceAssignments(
      sessionId,
      input.brokerAssignments,
    );
    this.deps.brokerRouting.upsertSessionOverrides(
      sessionId,
      Object.entries(input.brokerOverridesByInstrumentClass ?? {}).map(
        ([instrumentClass, brokerAccountId]) => ({
          instrumentClass: instrumentClass as InstrumentClass,
          brokerAccountId:
            typeof brokerAccountId === "string" ? brokerAccountId : null,
        }),
      ),
    );
    this.deps.signals?.replaceSessionSubscriptions(
      sessionId,
      input.subscribedSourceIds ?? [],
    );
    this.syncMockRehearsalSignalSource(input);
    // Any change to brokers / routing / execution mode invalidates a prior
    // live-readiness acknowledgement — operator must re-confirm.
    this.deps.liveReadiness?.clearAcknowledgement(sessionId);
  }

  private validate(
    input: SessionWriteInput,
    ctx: { excludeSessionId: string | null },
  ): NormalizedSessionWriteInput {
    const trimmedName = input.name.trim();
    if (
      this.deps.sessions
        .list({ includeArchived: true })
        .some(
          (session) =>
            session.id !== ctx.excludeSessionId &&
            session.name.toLowerCase() === trimmedName.toLowerCase(),
        )
    ) {
      throw new AppError(
        `A session named "${trimmedName}" already exists.`,
        "VALIDATION_FAILED",
        {
          field: "name",
        },
      );
    }

    const subscribedSourceIds = input.subscribedSourceIds ?? [];
    const requiresInstrumentScope =
      this.deps.signals?.requiresInstrumentScopeForSourceIds(
        subscribedSourceIds,
      ) ?? true;
    if (requiresInstrumentScope && !input.instrumentScope.trim()) {
      throw new AppError(
        "Instrument scope cannot be empty.",
        "VALIDATION_FAILED",
        {
          field: "instrumentScope",
        },
      );
    }

    const brokers = this.deps.brokerAccounts.list();
    const brokerById = new Map(brokers.map((broker) => [broker.id, broker]));
    const selectedBrokerIds = [
      ...new Set(
        input.brokerAssignments.map((assignment) => assignment.brokerAccountId),
      ),
    ];
    const requiredMode =
      input.executionMode === "live_allowed" ? "live" : "paper";

    if (selectedBrokerIds.length === 0) {
      throw new AppError(
        "Select at least one broker account.",
        "VALIDATION_FAILED",
        {
          field: "brokerAssignments",
        },
      );
    }

    const brokerAssignments = selectedBrokerIds.map((brokerAccountId) => {
      const match = input.brokerAssignments.find(
        (assignment) => assignment.brokerAccountId === brokerAccountId,
      );
      return {
        brokerAccountId,
        allocatedUsd: match ? Math.max(0, Number(match.allocatedUsd) || 0) : 0,
      };
    });

    const selectedBrokers = selectedBrokerIds.map((id) => {
      const broker = brokerById.get(id);
      if (!broker) {
        throw new AppError(`Broker account ${id} was not found.`, "NOT_FOUND", {
          brokerAccountId: id,
        });
      }
      if (broker.mode !== requiredMode) {
        throw new AppError(
          `Broker "${broker.name}" is ${broker.mode} but session mode is ${requiredMode}.`,
          "VALIDATION_FAILED",
          { brokerAccountId: id, brokerMode: broker.mode, requiredMode },
        );
      }
      return broker;
    });

    const experienceId = input.experienceId ?? "edgar-catalyst";
    let experience;
    try {
      experience = requireExperience(experienceId);
    } catch {
      throw new AppError(
        `Experience "${experienceId}" was not found.`,
        "NOT_FOUND",
        { experienceId, field: "experienceId" },
      );
    }

    const instrumentClasses = resolveSessionInstrumentClasses(
      experience.capabilities,
      input,
      selectedBrokers,
    );

    if (instrumentClasses.length === 0) {
      throw new AppError(
        "At least one instrument class is required.",
        "VALIDATION_FAILED",
        {
          field: "instrumentClasses",
        },
      );
    }

    for (const broker of selectedBrokers) {
      if (
        !brokerOverlapsExperience(
          broker,
          experience.capabilities.instrumentClasses,
        )
      ) {
        throw new AppError(
          `Broker "${broker.name}" does not support any instrument class required by ${experience.displayName}.`,
          "VALIDATION_FAILED",
          {
            brokerAccountId: broker.id,
            supports: broker.supportedInstrumentClasses,
            experienceClasses: experience.capabilities.instrumentClasses,
          },
        );
      }
    }

    if (
      !isSessionLaunchable(
        experience.capabilities.instrumentClasses,
        selectedBrokers,
      )
    ) {
      throw new AppError(
        `Selected brokers do not cover any instrument class supported by ${experience.displayName}.`,
        "VALIDATION_FAILED",
        {
          field: "brokerAssignments",
          experienceClasses: experience.capabilities.instrumentClasses,
        },
      );
    }

    for (const sourceId of subscribedSourceIds) {
      const source = this.deps.signals?.getSource(sourceId);
      if (!source) {
        throw new AppError(
          `Signal source ${sourceId} was not found.`,
          "NOT_FOUND",
          { sourceId, field: "subscribedSourceIds" },
        );
      }
      if (!experience.capabilities.signalSourceTypes.includes(source.type)) {
        throw new AppError(
          `${experience.displayName} does not support ${source.type} signal sources.`,
          "VALIDATION_FAILED",
          {
            field: "subscribedSourceIds",
            experienceId: experience.id,
            sourceType: source.type,
            allowedSourceTypes: experience.capabilities.signalSourceTypes,
          },
        );
      }
    }

    if (experience.capabilities.brokerRequirement === "polymarket_broker") {
      const hasPolymarketBroker = selectedBrokers.some(
        (broker) => broker.brokerType === "polymarket",
      );
      if (!hasPolymarketBroker) {
        throw new AppError(
          `${experience.displayName} requires at least one Polymarket broker account.`,
          "VALIDATION_FAILED",
          {
            field: "brokerAssignments",
            brokerRequirement: experience.capabilities.brokerRequirement,
          },
        );
      }
    }

    for (const [instrumentClass, brokerAccountId] of Object.entries(
      input.brokerOverridesByInstrumentClass ?? {},
    )) {
      if (typeof brokerAccountId !== "string" || brokerAccountId.length === 0)
        continue;
      const broker = brokerById.get(brokerAccountId);
      if (!broker) {
        throw new AppError(
          `Override broker ${brokerAccountId} was not found.`,
          "NOT_FOUND",
          { brokerAccountId },
        );
      }
      if (
        !broker.supportedInstrumentClasses.includes(
          instrumentClass as InstrumentClass,
        )
      ) {
        throw new AppError(
          `Broker "${broker.name}" does not support ${instrumentClass}.`,
          "VALIDATION_FAILED",
          { brokerAccountId, instrumentClass },
        );
      }
    }

    return {
      ...input,
      brokerAssignments,
      instrumentClasses,
      experienceId,
    };
  }

  private syncMockRehearsalSignalSource(input: SessionWriteInput): void {
    const subscribedSourceIds = input.subscribedSourceIds ?? [];
    if (
      !subscribedSourceIds.includes(MOCK_REHEARSAL_SIGNAL_SOURCE_ID) ||
      !this.deps.signals?.syncMockRehearsalSignalSourceTicker
    ) {
      return;
    }

    const experienceId = input.experienceId ?? "edgar-catalyst";
    let experience;
    try {
      experience = requireExperience(experienceId);
    } catch {
      return;
    }

    const brokerAccounts = this.deps.brokerAccounts.list();
    const brokerAssignmentIds = input.brokerAssignments.map(
      (assignment) => assignment.brokerAccountId,
    );
    if (
      !sessionEligibleForMockRehearsal({
        experience: experience.capabilities,
        brokerAccounts: brokerAccounts.map((broker) => ({
          id: broker.id,
          brokerType: broker.brokerType,
          mockScenarioKind: broker.mockScenarioKind ?? null,
        })),
        brokerAssignmentIds,
      })
    ) {
      return;
    }

    const ticker = resolveMockRehearsalTickerFromBrokers(
      brokerAccounts.map((broker) => ({
        id: broker.id,
        brokerType: broker.brokerType,
        mockScenarioKind: broker.mockScenarioKind ?? null,
      })),
      brokerAssignmentIds,
    );
    this.deps.signals.syncMockRehearsalSignalSourceTicker(ticker);
  }
}
