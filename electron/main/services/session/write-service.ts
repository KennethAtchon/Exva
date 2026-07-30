import type { InstrumentClass, WorkspaceSession } from "@/lib/types";
import {
  isSessionLaunchable,
  resolveSessionInstrumentClasses,
} from "@electron/shared/instruments/experience-launchability";
import { AppError } from "@electron/shared/infra/errors";
import { requireExperience } from "../../experiences/index";
import type { EventsRepo } from "../../db/repositories/system/events-repo";
import type { SessionRepo } from "../../db/repositories/sessions/session-repo";
import type { SessionStrategyContextService } from "./session-strategy-context-service";
import type { SessionBrokerAssignmentsRepo } from "../../db/repositories/sessions/session-broker-assignments-repo";
import type { BrokerRoutingRepo } from "../../db/repositories/brokers/broker-routing-repo";
import type { BrokerAccountsRepo } from "../../db/repositories/brokers/broker-accounts-repo";
import { createLogger } from "../infra/log";
import {
  validateSessionWriteConfiguration,
} from "./session-config-validation-builder";
import { hasBlockingConfigIssues } from "./session-config-validation";

const logger = createLogger("session-write-service");

export interface SessionWriteInput {
  name: string;
  objective: string;
  selectionMode: WorkspaceSession["selectionMode"];
  instrumentScope: string;
  defaultSearchProviderId?: string | null;
  selectorSettings: { aiPickerEnabled: boolean };
  executionMode: WorkspaceSession["executionMode"];
  brokerAssignments: Array<{ brokerAccountId: string; allocatedUsd: number }>;
  brokerOverridesByInstrumentClass?: Partial<
    Record<InstrumentClass, string | null>
  >;
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
      strategyContext: SessionStrategyContextService;
      assignments: SessionBrokerAssignmentsRepo;
      brokerRouting: BrokerRoutingRepo;
      brokerAccounts: BrokerAccountsRepo;
      /** Optional: live-readiness acknowledgement is invalidated on every mutation
       *  that changes broker, routing, or execution-mode context. */
      liveReadiness?: { clearAcknowledgement(sessionId: string): void };
      /**
       * V2: Optional hook called after a new session is created to provision
       * default input subscriptions from the experience's default profile.
       * When provided, called with the new sessionId and experienceId.
       */
      provisionDefaultInputs?(sessionId: string, experienceId: string): void;
      /**
       * V2: Optional hook called after create/update to reconcile the
       * schedule coordinator with the new subscription set.
       */
      reconcileScheduleCoordinator?(): void;
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

    // V2: provision default input subscriptions when the hook is wired.
    try {
      this.deps.provisionDefaultInputs?.(session.id, normalized.experienceId);
      this.deps.reconcileScheduleCoordinator?.();
    } catch (err) {
      // Non-fatal for session row creation, but must be visible — without
      // default inputs the session won't receive signals.
      logger.warn(
        { sessionId: session.id, err },
        "failed to provision V2 default inputs",
      );
      this.deps.events.insert({
        session_id: session.id,
        trade_id: null,
        level: "WARN",
        agent_type: "session",
        message: `Default input provisioning failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

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
    this.deps.strategyContext.saveSelectorSettings(
      sessionId,
      input.selectorSettings,
    );
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

    // Event-driven experiences receive tickers via signals and don't require a
    // scope. Scan-hit and manual experiences need an instrument scope for scanning.
    const requiresInstrumentScope =
      experience.capabilities.signalSourceTypes.length === 0;
    if (requiresInstrumentScope && !input.instrumentScope.trim()) {
      throw new AppError(
        "Instrument scope cannot be empty.",
        "VALIDATION_FAILED",
        {
          field: "instrumentScope",
        },
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

    if (!isSessionLaunchable(selectedBrokers)) {
      throw new AppError(
        `${experience.displayName} requires at least one broker account assigned.`,
        "VALIDATION_FAILED",
        { field: "brokerAssignments" },
      );
    }

    const configIssues = validateSessionWriteConfiguration(input, {
      instrumentClasses,
      brokerAccounts: this.deps.brokerAccounts,
    });
    const blockingIssues = configIssues.filter((i) => i.severity === "block");
    if (hasBlockingConfigIssues(configIssues)) {
      throw new AppError(
        blockingIssues.map((i) => i.message).join(" "),
        "VALIDATION_FAILED",
        { configIssues },
      );
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
}
