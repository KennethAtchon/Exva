import { ipcMain } from "electron";
import { channels } from "@electron/shared/ipc/channels";
import { rendererDiagnosticSchema } from "@electron/shared/diagnostics/runtime-diagnostic";
import type { AppServices } from "../../services/app-services";
import { handle } from "../handle";
import { recordRuntimeDiagnostic } from "../../services/infra/runtime-diagnostics";

export function registerDiagnosticsHandlers(services: AppServices): void {
  handle(
    ipcMain,
    channels.diagnostics.reportRendererError,
    rendererDiagnosticSchema,
    async (payload, event) => {
      const kind =
        payload.kind === "unhandled_rejection"
          ? "renderer_unhandled_rejection"
          : payload.kind === "react_error_boundary"
            ? "react_error_boundary"
            : payload.kind === "bootstrap_error"
              ? "renderer_bootstrap_error"
              : "renderer_error";
      recordRuntimeDiagnostic({
        kind,
        eventId: payload.eventId,
        services,
        detail: {
          senderId: event.sender.id,
          occurredAt: payload.occurredAt,
          name: payload.name ?? null,
          message: payload.message,
          stack: payload.stack ?? null,
          componentStack: payload.componentStack ?? null,
          route: payload.route ?? null,
        },
      });
      return { recorded: true as const, eventId: payload.eventId };
    },
  );
}
