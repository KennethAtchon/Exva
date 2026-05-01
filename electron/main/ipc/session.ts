import { ipcMain } from "electron";
import { AppError } from "@electron/shared/errors";
import { channels } from "@electron/shared/channels";
import type { AppServices } from "../services/app-services";
import { handle } from "./handle";

export function registerSessionHandlers(services: AppServices): void {
  handle(ipcMain, channels.session.start, async () => services.session.start());
  handle(ipcMain, channels.session.pause, async () => services.session.pause());
  handle(ipcMain, channels.session.resume, async () => services.session.resume());
  handle(ipcMain, channels.session.stop, async () => services.session.stop());
  handle(ipcMain, channels.session.getStatus, async () => services.session.getStatus());

  handle(ipcMain, channels.session.list, async (payload) => {
    const filters = (payload ?? {}) as {
      status?: string;
      instrumentClass?: string;
      search?: string;
      includeArchived?: boolean;
    };
    const sessions = services.repos.session
      .list({
        statuses: filters.status ? [filters.status as never] : undefined,
        includeArchived: filters.includeArchived,
      })
      .filter((session) => !filters.search || session.name.toLowerCase().includes(filters.search.toLowerCase()) || session.objective.toLowerCase().includes(filters.search.toLowerCase()))
      .filter((session) => !filters.instrumentClass || session.instrumentClasses.includes(filters.instrumentClass as never))
      .map((session) => ({
        ...session,
        brokerCount: services.repos.sessionBrokerAssignments.countBySession(session.id),
        openTradeCount: services.repos.trades.listOpenAndPending(session.id).filter((trade) => trade.status === "open").length,
      }));

    const focused = services.repos.session.getFocused();
    return {
      workspaceViewMode: focused ? "session" : "global",
      focusedSessionId: focused?.id ?? null,
      sessions,
    };
  });

  handle(ipcMain, channels.session.create, async (payload) => {
    const input = payload as {
      name: string;
      objective: string;
      selectionMode: "manual_shortlist" | "ai_selected_universe";
      instrumentClasses: Array<"stock" | "crypto" | "futures">;
      instrumentScope: string;
      defaultSearchProviderId?: string | null;
      selectorSettings: { aiPickerEnabled: boolean };
      capitalLimitUsd: number;
      executionMode: "paper_only" | "live_allowed";
      brokerAccountIds: string[];
      brokerOverridesByInstrumentClass?: Partial<Record<"stock" | "crypto" | "futures", string | null>>;
    };

    if (!input.name.trim() || !input.objective.trim() || input.instrumentClasses.length === 0 || !input.instrumentScope.trim()) {
      throw new AppError("Session definition is incomplete.", "VALIDATION_FAILED");
    }

    const session = services.repos.session.create({
      name: input.name.trim(),
      objective: input.objective.trim(),
      selectionMode: input.selectionMode,
      instrumentClasses: input.instrumentClasses,
      instrumentScope: input.instrumentScope,
      defaultSearchProviderId: input.defaultSearchProviderId ?? null,
      capitalLimitUsd: input.capitalLimitUsd,
      executionMode: input.executionMode,
    });
    services.repos.session.setFocus(session.id);
    services.repos.sessionSelectorSettings.update(session.id, input.selectorSettings);
    services.repos.sessionBrokerAssignments.replaceAssignments(
      session.id,
      input.brokerAccountIds.length > 0 ? input.brokerAccountIds : ["default-broker"],
    );
    services.repos.brokerRouting.upsertSessionOverrides(
      session.id,
      Object.entries(input.brokerOverridesByInstrumentClass ?? {}).map(([instrumentClass, brokerAccountId]) => ({
        instrumentClass: instrumentClass as "stock" | "crypto" | "futures",
        brokerAccountId: (typeof brokerAccountId === "string" ? brokerAccountId : null),
      })),
    );
    return { id: session.id, status: "draft" as const };
  });

  handle(ipcMain, channels.session.update, async (payload) => {
    const { id, input } = payload as { id: string; input: any };
    services.repos.session.updateTaskBoundary(id, {
      name: input.name,
      objective: input.objective,
      selectionMode: input.selectionMode,
      instrumentClasses: input.instrumentClasses,
      instrumentScope: input.instrumentScope,
      defaultSearchProviderId: input.defaultSearchProviderId ?? null,
      capitalLimitUsd: input.capitalLimitUsd,
      executionMode: input.executionMode,
    });
    services.repos.sessionSelectorSettings.update(id, input.selectorSettings);
    services.repos.sessionBrokerAssignments.replaceAssignments(id, input.brokerAccountIds.length > 0 ? input.brokerAccountIds : ["default-broker"]);
    services.repos.brokerRouting.upsertSessionOverrides(
      id,
      Object.entries(input.brokerOverridesByInstrumentClass ?? {}).map(([instrumentClass, brokerAccountId]) => ({
        instrumentClass: instrumentClass as "stock" | "crypto" | "futures",
        brokerAccountId: (typeof brokerAccountId === "string" ? brokerAccountId : null),
      })),
    );
    return { savedAt: new Date().toISOString() };
  });

  handle(ipcMain, channels.session.focus, async (payload) => {
    const id = (payload as { id: string }).id;
    services.repos.session.setFocus(id);
    return { workspaceViewMode: "session" as const, focusedSessionId: id };
  });

  handle(ipcMain, channels.session.goGlobal, async () => {
    const sessions = services.repos.session.list({ includeArchived: false }).filter((session) => session.status !== "archived");
    if (sessions.length === 0) {
      throw new AppError("Cannot switch to global mode without sessions.", "VALIDATION_FAILED");
    }
    services.repos.session.clearFocus();
    return { workspaceViewMode: "global" as const, focusedSessionId: null };
  });

  handle(ipcMain, channels.session.archive, async (payload) => {
    const id = (payload as { id: string }).id;
    const session = services.repos.session.requireById(id);
    if (session.status === "active" || session.status === "paused") {
      throw new AppError("Stop the session before archiving it.", "INVALID_TRANSITION", { id });
    }
    services.repos.session.setStatus("archived", id);
    if (session.isFocused) {
      services.repos.session.clearFocus();
    }
    return { archived: true };
  });

  handle(ipcMain, channels.session.duplicate, async (payload) => {
    const { sourceId, name } = payload as { sourceId: string; name: string };
    const session = services.repos.session.duplicate(sourceId, { name });
    return { id: session.id, status: "draft" as const };
  });
}
