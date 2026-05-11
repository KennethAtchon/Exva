import type { InstrumentClass, WorkspaceSession } from "@/lib/types";
import { AppError } from "@electron/shared/errors";
import type { EventsRepo } from "../../db/repositories/events-repo";
import type { SessionRepo } from "../../db/repositories/session-repo";
import type { SessionSelectorSettingsRepo } from "../../db/repositories/session-selector-settings-repo";
import type { SessionBrokerAssignmentsRepo } from "../../db/repositories/session-broker-assignments-repo";
import type { BrokerRoutingRepo } from "../../db/repositories/broker-routing-repo";
import type { BrokerAccountsRepo } from "../../db/repositories/broker-accounts-repo";

export interface SessionWriteInput {
  name: string;
  objective: string;
  selectionMode: WorkspaceSession["selectionMode"];
  instrumentClasses: InstrumentClass[];
  instrumentScope: string;
  defaultSearchProviderId?: string | null;
  selectorSettings: { aiPickerEnabled: boolean };
  capitalLimitUsd: number;
  executionMode: WorkspaceSession["executionMode"];
  brokerAccountIds: string[];
  brokerOverridesByInstrumentClass?: Partial<Record<InstrumentClass, string | null>>;
}

export class SessionWriteService {
  constructor(
    private readonly deps: {
      sessions: SessionRepo;
      events: EventsRepo;
      selectorSettings: SessionSelectorSettingsRepo;
      assignments: SessionBrokerAssignmentsRepo;
      brokerRouting: BrokerRoutingRepo;
      brokerAccounts: BrokerAccountsRepo;
    },
  ) {}

  create(input: SessionWriteInput): { id: string; status: "draft" } {
    this.validate(input, { excludeSessionId: null });

    const session = this.deps.sessions.create({
      name: input.name.trim(),
      objective: input.objective.trim(),
      selectionMode: input.selectionMode,
      instrumentClasses: input.instrumentClasses,
      instrumentScope: input.instrumentScope.trim(),
      defaultSearchProviderId: input.defaultSearchProviderId ?? null,
      capitalLimitUsd: input.capitalLimitUsd,
      executionMode: input.executionMode,
    });
    this.deps.sessions.setFocus(session.id);
    this.applySideTables(session.id, input);
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
    this.validate(input, { excludeSessionId: id });

    this.deps.sessions.updateTaskBoundary(id, {
      name: input.name.trim(),
      objective: input.objective.trim(),
      selectionMode: input.selectionMode,
      instrumentClasses: input.instrumentClasses,
      instrumentScope: input.instrumentScope.trim(),
      defaultSearchProviderId: input.defaultSearchProviderId ?? null,
      capitalLimitUsd: input.capitalLimitUsd,
      executionMode: input.executionMode,
    });
    this.applySideTables(id, input);
    return { savedAt: new Date().toISOString() };
  }

  private applySideTables(sessionId: string, input: SessionWriteInput): void {
    this.deps.selectorSettings.update(sessionId, input.selectorSettings);
    this.deps.assignments.replaceAssignments(sessionId, input.brokerAccountIds);
    this.deps.brokerRouting.upsertSessionOverrides(
      sessionId,
      Object.entries(input.brokerOverridesByInstrumentClass ?? {}).map(([instrumentClass, brokerAccountId]) => ({
        instrumentClass: instrumentClass as InstrumentClass,
        brokerAccountId: typeof brokerAccountId === "string" ? brokerAccountId : null,
      })),
    );
  }

  private validate(input: SessionWriteInput, ctx: { excludeSessionId: string | null }): void {
    const trimmedName = input.name.trim();
    if (this.deps.sessions
      .list({ includeArchived: true })
      .some((session) => session.id !== ctx.excludeSessionId && session.name.toLowerCase() === trimmedName.toLowerCase())) {
      throw new AppError(`A session named "${trimmedName}" already exists.`, "VALIDATION_FAILED", {
        field: "name",
      });
    }

    if (!input.instrumentScope.trim()) {
      throw new AppError("Instrument scope cannot be empty.", "VALIDATION_FAILED", {
        field: "instrumentScope",
      });
    }

    const brokers = this.deps.brokerAccounts.list();
    const brokerById = new Map(brokers.map((broker) => [broker.id, broker]));
    const selectedBrokerIds = [...new Set(input.brokerAccountIds)];
    const requiredMode = input.executionMode === "live_allowed" ? "live" : "paper";

    if (selectedBrokerIds.length === 0) {
      throw new AppError("Select at least one broker account.", "VALIDATION_FAILED", {
        field: "brokerAccountIds",
      });
    }

    const selectedBrokers = selectedBrokerIds.map((id) => {
      const broker = brokerById.get(id);
      if (!broker) {
        throw new AppError(`Broker account ${id} was not found.`, "NOT_FOUND", { brokerAccountId: id });
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

    for (const broker of selectedBrokers) {
      const overlap = broker.supportedInstrumentClasses.some((cls) => input.instrumentClasses.includes(cls));
      if (!overlap) {
        throw new AppError(
          `Broker "${broker.name}" does not support any of the selected instrument classes.`,
          "VALIDATION_FAILED",
          { brokerAccountId: broker.id, supports: broker.supportedInstrumentClasses, requested: input.instrumentClasses },
        );
      }
    }

    for (const instrumentClass of input.instrumentClasses) {
      const covered = selectedBrokers.some((broker) => broker.supportedInstrumentClasses.includes(instrumentClass));
      if (!covered) {
        throw new AppError(
          `No selected broker can trade ${instrumentClass}.`,
          "VALIDATION_FAILED",
          { instrumentClass, field: "brokerAccountIds" },
        );
      }
    }

    for (const [instrumentClass, brokerAccountId] of Object.entries(input.brokerOverridesByInstrumentClass ?? {})) {
      if (typeof brokerAccountId !== "string" || brokerAccountId.length === 0) continue;
      const broker = brokerById.get(brokerAccountId);
      if (!broker) {
        throw new AppError(`Override broker ${brokerAccountId} was not found.`, "NOT_FOUND", { brokerAccountId });
      }
      if (!broker.supportedInstrumentClasses.includes(instrumentClass as InstrumentClass)) {
        throw new AppError(
          `Broker "${broker.name}" does not support ${instrumentClass}.`,
          "VALIDATION_FAILED",
          { brokerAccountId, instrumentClass },
        );
      }
    }
  }
}
