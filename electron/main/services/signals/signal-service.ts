import {
  sessionRequiresInstrumentScope,
  type SignalSourceRecord,
} from "@electron/shared/domain";
import type { SignalDeadLetterReason } from "@electron/shared/domain/signal-dead-letters";
import { AppError } from "@electron/shared/infra/errors";
import {
  ensureAllExperienceSignalSources,
  ensureExperienceSignalSources,
} from "../../experiences/ensure-experience-signal-sources";
import {
  ensureMockRehearsalSignalSource,
  syncMockRehearsalSignalSourceTicker,
} from "../../experiences/ensure-mock-rehearsal-signal-source";
import { migrateEligibleSessionsToMockRehearsal } from "../../experiences/migrate-mock-rehearsal-subscriptions";
import { resolveMockRehearsalTicker } from "@electron/shared/instruments/mock-rehearsal";
import { SignalDeadLettersRepo } from "./repos/signal-dead-letters-repo";
import { SignalDeliveriesRepo } from "./repos/signal-deliveries-repo";
import { SignalEventsRepo } from "./repos/signal-events-repo";
import { SignalSourcesRepo } from "./repos/signal-sources-repo";
import { SignalSourceRegistry } from "./signal-source-registry";
import { SignalBus } from "./signal-bus";

const MANUAL_SOURCE_ID = "manual_source";
type SessionReadiness =
  | "armed"
  | "manual_only"
  | "waiting_for_source_enable"
  | "no_inputs";

export class SignalService {
  constructor(
    private readonly sourcesRepo: SignalSourcesRepo,
    private readonly eventsRepo: SignalEventsRepo,
    private readonly deliveriesRepo: SignalDeliveriesRepo,
    private readonly deadLettersRepo: SignalDeadLettersRepo,
    private readonly registry: SignalSourceRegistry,
    private readonly signalBus: SignalBus,
    private readonly sessionRepo?: {
      list(input?: {
        includeArchived?: boolean;
      }): Array<{ id: string; name: string }>;
    },
  ) {}

  listSources(): Array<
    SignalSourceRecord & {
      runtimeStatus: string;
      runtimeLastError: string | null;
      attachedSessionCount: number;
    }
  > {
    this.ensureAllExperienceSignalSources();
    this.ensureMockRehearsalSignalSource();
    return this.sourcesRepo.list().map((source) => {
      const runtime = this.registry.status(source.id);
      const snapshot = this.registry.snapshot(source.id);
      return {
        ...source,
        runtimeStatus: runtime?.status ?? "idle",
        runtimeLastError: runtime?.lastError ?? null,
        attachedSessionCount: this.sourcesRepo.attachedSessionCount(source.id),
        attachedSessionNames: this.sourcesRepo.attachedSessionNames(source.id),
        lastPollAt: snapshot?.lastPollAt ?? null,
        lastPollResult: snapshot?.lastPollResult ?? null,
        lastSignalAt: snapshot?.lastSignalAt ?? null,
        lastSignalTicker: snapshot?.lastSignalTicker ?? null,
        recentActivity: snapshot?.recentActivity ?? [],
      };
    });
  }

  async createSource(input: {
    type: SignalSourceRecord["type"];
    name: string;
    description?: string | null;
    config?: Record<string, unknown>;
  }): Promise<SignalSourceRecord> {
    const source = this.sourcesRepo.create({
      id: crypto.randomUUID(),
      type: input.type,
      name: input.name,
      description: input.description ?? null,
      enabled: true,
      configJson: JSON.stringify(input.config ?? {}),
    });
    this.registry.create(source);
    await this.registry.start(source.id);
    return source;
  }

  ensureExperienceSignalSource(experienceId: string): SignalSourceRecord[] {
    const sources = ensureExperienceSignalSources(
      this.sourcesRepo,
      experienceId,
    );
    for (const source of sources) {
      if (!this.registry.get(source.id)) {
        this.registry.create(source);
        if (source.enabled) {
          void this.registry.start(source.id);
        }
      }
    }
    return sources;
  }

  ensureAllExperienceSignalSources(): SignalSourceRecord[] {
    const sources = ensureAllExperienceSignalSources(this.sourcesRepo);
    for (const source of sources) {
      if (!this.registry.get(source.id)) {
        this.registry.create(source);
        if (source.enabled) {
          void this.registry.start(source.id);
        }
      }
    }
    return sources;
  }

  ensureMockRehearsalSignalSource(
    ticker: string = resolveMockRehearsalTicker(),
  ): SignalSourceRecord {
    const source = ensureMockRehearsalSignalSource(this.sourcesRepo, ticker);
    if (!this.registry.get(source.id)) {
      this.registry.create(source);
      if (source.enabled) {
        void this.registry.start(source.id);
      }
    } else {
      const runtime = this.registry.get(source.id);
      if (runtime) {
        void runtime.restart(
          JSON.parse(source.configJson) as Record<string, unknown>,
        );
      }
    }
    return source;
  }

  syncMockRehearsalSignalSourceTicker(ticker: string): SignalSourceRecord {
    const source = syncMockRehearsalSignalSourceTicker(
      this.sourcesRepo,
      ticker,
    );
    const runtime = this.registry.get(source.id);
    if (runtime) {
      void runtime.restart(
        JSON.parse(source.configJson) as Record<string, unknown>,
      );
    }
    return source;
  }

  migrateEligibleSessionsToMockRehearsal(deps: {
    sessions: Array<{ id: string; experienceId: string }>;
    listAssignments: (sessionId: string) => Array<{ brokerAccountId: string }>;
    brokerAccounts: Array<{
      id: string;
      brokerType: string;
      mockScenarioKind?:
        | import("@electron/shared/domain/mock-scenario").MockScenarioKind
        | null;
    }>;
  }): string[] {
    return migrateEligibleSessionsToMockRehearsal({
      sessions: deps.sessions,
      listAssignments: deps.listAssignments,
      brokerAccounts: deps.brokerAccounts,
      signalSources: this.sourcesRepo,
      syncTicker: (ticker) => {
        this.syncMockRehearsalSignalSourceTicker(ticker);
      },
    });
  }

  getSource(sourceId: string): SignalSourceRecord | null {
    return this.sourcesRepo.get(sourceId);
  }

  listSubscribedSourcesForSession(
    sessionId: string,
  ): Array<SignalSourceRecord & { enabled: boolean }> {
    return this.sourcesRepo
      .subscribedSourceStatesForSession(sessionId)
      .flatMap(({ sourceId, enabled }) => {
        const source = this.sourcesRepo.get(sourceId);
        return source ? [{ ...source, enabled }] : [];
      });
  }

  async updateSource(
    sourceId: string,
    patch: Partial<{
      name: string;
      description: string | null;
      enabled: boolean;
      config: Record<string, unknown>;
    }>,
  ): Promise<SignalSourceRecord> {
    const next = this.sourcesRepo.update(sourceId, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined
        ? { description: patch.description }
        : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.config !== undefined
        ? { configJson: JSON.stringify(patch.config) }
        : {}),
    });
    if (patch.config !== undefined) {
      await this.registry.restart(sourceId, patch.config);
    }
    if (patch.enabled === true) await this.registry.start(sourceId);
    if (patch.enabled === false) await this.registry.stop(sourceId);
    return next;
  }

  async deleteSource(
    sourceId: string,
    options?: { forceDetach?: boolean },
  ): Promise<void> {
    if (
      this.sourcesRepo.attachedSessionCount(sourceId) > 0 &&
      !options?.forceDetach
    ) {
      throw new AppError("Source is attached to sessions", "VALIDATION_FAILED");
    }
    await this.registry.remove(sourceId);
    this.sourcesRepo.delete(sourceId);
  }

  async testSource(sourceId: string) {
    const result = await this.registry.test(sourceId);
    if (!result) {
      throw new AppError(`Signal source ${sourceId} not found.`, "NOT_FOUND", {
        sourceId,
      });
    }
    return result;
  }

  async enableSource(sourceId: string): Promise<void> {
    this.sourcesRepo.setEnabled(sourceId, true);
    await this.registry.start(sourceId);
  }

  async disableSource(sourceId: string): Promise<void> {
    this.sourcesRepo.setEnabled(sourceId, false);
    await this.registry.stop(sourceId);
  }

  listEventsBySession(input: {
    sessionId: string;
    statusBucket?: "pending" | "completed" | "dropped";
    limit?: number;
  }) {
    return this.deliveriesRepo.listBySessionFiltered(input);
  }

  listDeadLettersBySession(input: {
    sessionId: string;
    reason?: SignalDeadLetterReason;
    limit?: number;
  }) {
    return this.deadLettersRepo.listBySessionFiltered(input);
  }

  async replayDeadLetter(
    deadLetterId: string,
  ): Promise<{ deliveryId: string }> {
    const deadLetter = this.deadLettersRepo.getById(deadLetterId);
    if (!deadLetter) {
      throw new AppError(
        `Dead letter ${deadLetterId} was not found.`,
        "NOT_FOUND",
        { deadLetterId },
      );
    }
    if (deadLetter.replayedAt) {
      throw new AppError(
        "This dead letter has already been replayed.",
        "VALIDATION_FAILED",
        { deadLetterId },
      );
    }

    const event = this.eventsRepo.getById(deadLetter.signalEventId);
    if (!event) {
      throw new AppError(
        `Signal event ${deadLetter.signalEventId} was not found.`,
        "NOT_FOUND",
        { signalEventId: deadLetter.signalEventId },
      );
    }

    const result = await this.signalBus.deliverOrDeadLetter(
      deadLetter.sessionId,
      event,
    );
    if (result.kind === "dead_letter") {
      throw new AppError(
        "Replay still rejected by the capability gate.",
        "VALIDATION_FAILED",
        { deadLetterId, newDeadLetterId: result.deadLetterId },
      );
    }

    this.deadLettersRepo.markReplayed(deadLetterId, result.deliveryId);
    return { deliveryId: result.deliveryId };
  }

  bootstrapFromDb(): void {
    if (!this.sourcesRepo.get(MANUAL_SOURCE_ID)) {
      this.sourcesRepo.create({
        id: MANUAL_SOURCE_ID,
        type: "manual",
        name: "Manual Source",
        description: "Implicit source for manual session tickers",
        enabled: true,
        configJson: "{}",
      });
    }
    for (const source of this.sourcesRepo.list()) {
      if (source.type === "manual") continue;
      this.registry.create(source);
      if (source.enabled) {
        void this.registry.start(source.id);
      }
    }
  }

  injectManualTickers(sessionId: string, instrumentScope: string): void {
    const tickers = instrumentScope
      .split(/[\n,]/)
      .map((part) => part.trim().toUpperCase())
      .filter(Boolean);
    for (const ticker of tickers) {
      this.signalBus.injectManual(
        {
          id: crypto.randomUUID(),
          sourceId: MANUAL_SOURCE_ID,
          sourceType: "manual",
          ticker,
          companyName: null,
          documentUrl: null,
          accessionNumber: null,
          payloadJson: { instrumentClass: "stock" },
          filedAt: new Date().toISOString(),
          detectedAt: new Date().toISOString(),
        },
        sessionId,
      );
    }
  }

  debugInjectSignal(sessionId: string): void {
    const subscribedSourceIds =
      this.sourcesRepo.subscribedSourceIdsForSession(sessionId);
    const source = subscribedSourceIds
      .map((id) => this.sourcesRepo.get(id))
      .find(
        (s): s is NonNullable<typeof s> =>
          s != null && s.type !== "mock" && s.type !== "manual",
      );

    let ticker = "SPY";
    let instrumentClass = "stock";
    let sourceId = MANUAL_SOURCE_ID;
    let sourceType: import("@electron/shared/domain").SignalSourceType =
      "manual";

    if (source) {
      sourceId = source.id;
      sourceType = source.type;
      if (source.instrumentClass) instrumentClass = source.instrumentClass;
      try {
        const cfg = JSON.parse(source.configJson) as Record<string, unknown>;
        if (typeof cfg.symbol === "string" && cfg.symbol.length > 0) {
          ticker = cfg.symbol;
        }
        if (typeof cfg.instrumentClass === "string") {
          instrumentClass = cfg.instrumentClass;
        }
      } catch {
        // unparseable configJson — keep defaults
      }
    }

    this.signalBus.injectManual(
      {
        id: crypto.randomUUID(),
        sourceId,
        sourceType,
        ticker,
        companyName: null,
        documentUrl: null,
        accessionNumber: null,
        payloadJson: { instrumentClass },
        filedAt: new Date().toISOString(),
        detectedAt: new Date().toISOString(),
      },
      sessionId,
    );
  }

  onSessionResumed(sessionId: string): void {
    const rows = this.deliveriesRepo.listBySessionAndStatus(
      sessionId,
      "waiting_for_resume",
    );
    const now = Date.now();
    for (const delivery of rows) {
      const expired =
        delivery.expiresAt != null && Date.parse(delivery.expiresAt) < now;
      if (expired) {
        this.deliveriesRepo.updateStatus(delivery.id, {
          status: "expired",
          statusBucket: "dropped",
          finishedAt: new Date().toISOString(),
        });
        this.signalBus.emitDeliveryUpdated({
          deliveryId: delivery.id,
          sessionId: delivery.sessionId,
          signalId: delivery.signalEventId,
          status: "expired",
          statusBucket: "dropped",
        });
      } else {
        this.deliveriesRepo.updateStatus(delivery.id, {
          status: "queued",
          statusBucket: "pending",
          expiresAt: null,
        });
        this.signalBus.emitDeliveryUpdated({
          deliveryId: delivery.id,
          sessionId: delivery.sessionId,
          signalId: delivery.signalEventId,
          status: "queued",
          statusBucket: "pending",
        });
      }
    }
  }

  replayStartup(): void {
    for (const delivery of this.deliveriesRepo.listByStatus("processing")) {
      this.deliveriesRepo.updateStatus(delivery.id, {
        status: "queued",
        statusBucket: "pending",
        startedAt: null,
      });
      this.signalBus.emitDeliveryUpdated({
        deliveryId: delivery.id,
        sessionId: delivery.sessionId,
        signalId: delivery.signalEventId,
        status: "queued",
        statusBucket: "pending",
      });
    }

    for (const delivery of this.deliveriesRepo.listByStatus(
      "waiting_for_resume",
    )) {
      const expired =
        delivery.expiresAt != null &&
        Date.parse(delivery.expiresAt) < Date.now();
      if (!expired) continue;
      this.deliveriesRepo.updateStatus(delivery.id, {
        status: "expired",
        statusBucket: "dropped",
        finishedAt: new Date().toISOString(),
      });
      this.signalBus.emitDeliveryUpdated({
        deliveryId: delivery.id,
        sessionId: delivery.sessionId,
        signalId: delivery.signalEventId,
        status: "expired",
        statusBucket: "dropped",
      });
    }

    // Conservative replay: mark orphaned new events as dropped when app restarts
    // without enough context to safely refan-out deterministic targets.
    for (const event of this.eventsRepo.listByDispatchStatus("new")) {
      this.eventsRepo.markDispatchStatus(
        event.id,
        "dropped_pre_fanout",
        "startup_replay_not_implemented",
      );
    }
  }

  deriveReadiness(
    sessionId: string,
    instrumentScope: string,
  ): SessionReadiness {
    const manualTickers = instrumentScope
      .split(/[\n,]/)
      .map((part) => part.trim())
      .filter(Boolean).length;
    const subscriptions =
      this.sourcesRepo.subscribedSourceStatesForSession(sessionId);
    const hasManual = manualTickers > 0;
    const enabledSources = subscriptions.filter((row) => row.enabled).length;
    const anySources = subscriptions.length > 0;
    if (enabledSources > 0 || hasManual) {
      return hasManual && enabledSources === 0 ? "manual_only" : "armed";
    }
    if (anySources) return "waiting_for_source_enable";
    return "no_inputs";
  }

  listSubscribedSourceIds(sessionId: string): string[] {
    return this.sourcesRepo.subscribedSourceIdsForSession(sessionId);
  }

  replaceSessionSubscriptions(sessionId: string, sourceIds: string[]): void {
    this.sourcesRepo.replaceSessionSubscriptions(sessionId, sourceIds);
  }

  requiresInstrumentScopeForSourceIds(sourceIds: string[]): boolean {
    const subscribedSources = sourceIds.flatMap((sourceId) => {
      const source = this.sourcesRepo.get(sourceId);
      return source ? [{ type: source.type }] : [];
    });
    return sessionRequiresInstrumentScope(subscribedSources);
  }
}
