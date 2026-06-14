import type {
  InstrumentClass,
  SessionStatus,
  WorkspaceViewMode,
} from "@/lib/types";
import {
  deriveSessionInputModel,
  deriveSessionReadiness,
} from "@electron/shared/instruments/session-input-model";
import type {
  SessionRepo,
  SessionFilters,
} from "../../db/repositories/sessions/session-repo";
import type { SessionBrokerAssignmentsRepo } from "../../db/repositories/sessions/session-broker-assignments-repo";
import type { TradesRepo } from "../../db/repositories/trades/trades-repo";
import type { SessionRuntimeManager } from "./session-runtime-manager";
import type { SignalSourcesRepo } from "../signals/repos/signal-sources-repo";
import type { BrokerAccountsRepo } from "../../db/repositories/brokers/broker-accounts-repo";
import { requireExperience } from "../../experiences/index";
import {
  MOCK_REHEARSAL_SIGNAL_SOURCE_ID,
  sessionEligibleForMockRehearsal,
  sessionSubscribedToMockRehearsal,
} from "@electron/shared/instruments/mock-rehearsal";

export interface SessionListFilters {
  status?: SessionStatus;
  instrumentClass?: InstrumentClass;
  search?: string;
  includeArchived?: boolean;
  executionMode?: "paper_only" | "live_allowed";
}

export interface SessionSummaryView {
  id: string;
  name: string;
  objective: string;
  status: SessionStatus;
  isFocused: boolean;
  selectionMode: ReturnType<SessionRepo["list"]>[number]["selectionMode"];
  instrumentClasses: InstrumentClass[];
  instrumentScope: string;
  defaultSearchProviderId: string | null;
  totalAllocatedUsd: number;
  executionMode: ReturnType<SessionRepo["list"]>[number]["executionMode"];
  brokerCount: number;
  openTradeCount: number;
  uptimeMin: number;
  updatedAt: string;
  experienceId: string;
  subscribedSources: Array<{
    id: string;
    name: string;
    type: import("@electron/shared/domain").SignalSourceType;
    enabled: boolean;
    configJson?: string;
  }>;
  readiness:
    | "armed"
    | "manual_only"
    | "waiting_for_source_enable"
    | "no_inputs";
  inputModel: "listener" | "search_scoped" | "manual_only" | "search_universe";
  rehearsalMode: boolean;
  rehearsalEligible: boolean;
  canFireRehearsalSignal: boolean;
}

export interface SessionListResult {
  workspaceViewMode: WorkspaceViewMode;
  focusedSessionId: string | null;
  sessions: SessionSummaryView[];
}

export class SessionListingService {
  constructor(
    private readonly deps: {
      sessionRepo: SessionRepo;
      assignments: SessionBrokerAssignmentsRepo;
      trades: TradesRepo;
      runtimeManager: SessionRuntimeManager;
      signalSources: SignalSourcesRepo;
      brokerAccounts: BrokerAccountsRepo;
    },
  ) {}

  list(filters: SessionListFilters = {}): SessionListResult {
    const repoFilters: SessionFilters = {
      statuses: filters.status ? [filters.status] : undefined,
      includeArchived: filters.includeArchived,
      executionMode: filters.executionMode,
    };
    const search = filters.search?.toLowerCase().trim() ?? "";
    const instrumentClass = filters.instrumentClass;

    const sessions = this.deps.sessionRepo
      .list(repoFilters)
      .filter(
        (session) =>
          !search ||
          session.name.toLowerCase().includes(search) ||
          session.objective.toLowerCase().includes(search),
      )
      .filter(
        (session) =>
          !instrumentClass ||
          session.instrumentClasses.includes(instrumentClass),
      )
      .map((session) => {
        const openTradeCount = this.deps.trades
          .listOpenAndPending(session.id)
          .filter((trade) => trade.status === "open").length;
        const assignments = this.deps.assignments.listAssignments(session.id);
        const subscribedSources = this.deps.signalSources
          .subscribedSourceStatesForSession(session.id)
          .flatMap(({ sourceId, enabled }) => {
            const source = this.deps.signalSources.get(sourceId);
            return source
              ? [
                  {
                    id: source.id,
                    name: source.name,
                    type: source.type,
                    enabled,
                    configJson: source.configJson,
                  },
                ]
              : [];
          });
        const inputModel = deriveSessionInputModel({
          subscribedSources,
          instrumentScope: session.instrumentScope,
        });
        const readiness = deriveSessionReadiness({
          subscribedSources,
          instrumentScope: session.instrumentScope,
        });
        const brokerAssignmentIds = assignments.map(
          (assignment) => assignment.brokerAccountId,
        );
        const brokerAccounts = this.deps.brokerAccounts.list();
        let experienceCapabilities;
        try {
          experienceCapabilities = requireExperience(
            session.experienceId,
          ).capabilities;
        } catch {
          experienceCapabilities = null;
        }
        const rehearsalEligible =
          experienceCapabilities &&
          sessionEligibleForMockRehearsal({
            experience: experienceCapabilities,
            brokerAccounts: brokerAccounts.map((broker) => ({
              id: broker.id,
              brokerType: broker.brokerType,
              mockScenarioKind: broker.mockScenarioKind ?? null,
            })),
            brokerAssignmentIds,
          });
        const subscribedMockRehearsal =
          sessionSubscribedToMockRehearsal(subscribedSources);
        const rehearsalMode = Boolean(
          rehearsalEligible && subscribedMockRehearsal,
        );
        const mockSourceEnabled = subscribedSources.some(
          (source) =>
            source.id === MOCK_REHEARSAL_SIGNAL_SOURCE_ID && source.enabled,
        );
        const canFireRehearsalSignal =
          rehearsalMode && session.status === "active" && mockSourceEnabled;
        return {
          id: session.id,
          name: session.name,
          objective: session.objective,
          status: session.status,
          isFocused: session.isFocused,
          selectionMode: session.selectionMode,
          instrumentClasses: session.instrumentClasses,
          instrumentScope: session.instrumentScope,
          defaultSearchProviderId: session.defaultSearchProviderId,
          totalAllocatedUsd: assignments.reduce(
            (sum, assignment) => sum + assignment.allocatedUsd,
            0,
          ),
          executionMode: session.executionMode,
          experienceId: session.experienceId,
          brokerCount: assignments.length,
          openTradeCount,
          uptimeMin: this.computeUptimeMin(session.id),
          updatedAt: session.updatedAt,
          subscribedSources,
          readiness,
          inputModel,
          rehearsalMode,
          rehearsalEligible: Boolean(rehearsalEligible),
          canFireRehearsalSignal,
        };
      });

    const focused = this.deps.sessionRepo.getFocused();
    return {
      workspaceViewMode: focused ? "session" : "global",
      focusedSessionId: focused?.id ?? null,
      sessions,
    };
  }

  computeUptimeMin(sessionId: string): number {
    const runtime = this.deps.runtimeManager.get(sessionId);
    if (!runtime) return 0;
    const startedAtMs = Date.parse(runtime.startedAt);
    if (Number.isNaN(startedAtMs)) return 0;
    return Math.max(0, Math.round((Date.now() - startedAtMs) / 60000));
  }
}
