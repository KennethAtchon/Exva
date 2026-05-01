import type { InstrumentClass, SessionStatus, WorkspaceViewMode } from "@/lib/types";
import type { SessionRepo, SessionFilters } from "../../db/repositories/session-repo";
import type { SessionBrokerAssignmentsRepo } from "../../db/repositories/session-broker-assignments-repo";
import type { TradesRepo } from "../../db/repositories/trades-repo";
import type { SessionRuntimeManager } from "./session-runtime-manager";

export interface SessionListFilters {
  status?: SessionStatus;
  instrumentClass?: InstrumentClass;
  search?: string;
  includeArchived?: boolean;
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
  capitalLimitUsd: number;
  executionMode: ReturnType<SessionRepo["list"]>[number]["executionMode"];
  brokerCount: number;
  openTradeCount: number;
  uptimeMin: number;
  updatedAt: string;
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
    },
  ) {}

  list(filters: SessionListFilters = {}): SessionListResult {
    const repoFilters: SessionFilters = {
      statuses: filters.status ? [filters.status] : undefined,
      includeArchived: filters.includeArchived,
    };
    const search = filters.search?.toLowerCase().trim() ?? "";
    const instrumentClass = filters.instrumentClass;

    const sessions = this.deps.sessionRepo
      .list(repoFilters)
      .filter((session) =>
        !search ||
        session.name.toLowerCase().includes(search) ||
        session.objective.toLowerCase().includes(search),
      )
      .filter((session) => !instrumentClass || session.instrumentClasses.includes(instrumentClass))
      .map((session) => {
        const openTradeCount = this.deps.trades
          .listOpenAndPending(session.id)
          .filter((trade) => trade.status === "open").length;
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
          capitalLimitUsd: session.capitalLimitUsd,
          executionMode: session.executionMode,
          brokerCount: this.deps.assignments.countBySession(session.id),
          openTradeCount,
          uptimeMin: this.computeUptimeMin(session.id),
          updatedAt: session.updatedAt,
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
