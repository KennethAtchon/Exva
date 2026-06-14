import { ipcMain } from "electron";
import { channels } from "@electron/shared/ipc/channels";
import { handle } from "./handle";
import type { AppServices } from "../services/app-services";

export function registerSignalHandlers(services: AppServices): void {
  handle(ipcMain, channels.signals.sources.list, async () => {
    return { sources: services.signals.listSources() };
  });

  handle(ipcMain, channels.signals.sources.create, async (payload) => {
    const input = payload as {
      type:
        | "edgar_8k"
        | "web_search"
        | "manual"
        | "prediction_event"
        | "mock"
        | "timer";
      name: string;
      description?: string | null;
      config?: Record<string, unknown>;
    };
    const source = await services.signals.createSource(input);
    return { source };
  });

  handle(ipcMain, channels.signals.sources.update, async (payload) => {
    const input = payload as {
      id: string;
      name?: string;
      description?: string | null;
      enabled?: boolean;
      config?: Record<string, unknown>;
    };
    const source = await services.signals.updateSource(input.id, {
      name: input.name,
      description: input.description,
      enabled: input.enabled,
      config: input.config,
    });
    return { source };
  });

  handle(ipcMain, channels.signals.sources.delete, async (payload) => {
    const input = payload as { id: string };
    await services.signals.deleteSource(input.id);
    return { ok: true };
  });

  handle(ipcMain, channels.signals.sources.enable, async (payload) => {
    const input = payload as { id: string };
    await services.signals.enableSource(input.id);
    return { ok: true };
  });

  handle(ipcMain, channels.signals.sources.test, async (payload) => {
    const input = payload as { id: string };
    return { result: await services.signals.testSource(input.id) };
  });

  handle(ipcMain, channels.signals.sources.disable, async (payload) => {
    const input = payload as { id: string };
    await services.signals.disableSource(input.id);
    return { ok: true };
  });

  handle(ipcMain, channels.signals.events.list, async (payload) => {
    const input = payload as {
      sessionId: string;
      statusBucket?: "pending" | "completed" | "dropped";
      limit?: number;
    };
    return { rows: services.signals.listEventsBySession(input) };
  });

  handle(ipcMain, channels.signals.deadLetters.list, async (payload) => {
    const input = payload as {
      sessionId: string;
      reason?:
        | "unsupported_by_experience"
        | "unsupported_by_signal_source"
        | "unsupported_by_assigned_broker"
        | "no_compatible_broker_route";
      limit?: number;
    };
    return { rows: services.signals.listDeadLettersBySession(input) };
  });

  handle(ipcMain, channels.signals.deadLetters.replay, async (payload) => {
    const input = payload as { deadLetterId: string };
    return services.signals.replayDeadLetter(input.deadLetterId);
  });

  handle(
    ipcMain,
    channels.signals.sessions.getSubscriptions,
    async (payload) => {
      const input = payload as { sessionId: string };
      return {
        sourceIds: services.signals.listSubscribedSourceIds(input.sessionId),
      };
    },
  );

  handle(
    ipcMain,
    channels.signals.sessions.setSubscriptions,
    async (payload) => {
      const input = payload as { sessionId: string; sourceIds: string[] };
      services.signals.replaceSessionSubscriptions(
        input.sessionId,
        input.sourceIds,
      );
      return { ok: true };
    },
  );

  handle(ipcMain, channels.signals.sessions.getReadiness, async (payload) => {
    const input = payload as { sessionId: string; instrumentScope: string };
    return {
      readiness: services.signals.deriveReadiness(
        input.sessionId,
        input.instrumentScope,
      ),
    };
  });
}
