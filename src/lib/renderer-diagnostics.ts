import type { RendererDiagnostic } from "@electron/shared/diagnostics/runtime-diagnostic";

function report(
  kind: RendererDiagnostic["kind"],
  reason: unknown,
  extra: Partial<RendererDiagnostic> = {},
): string {
  const eventId = crypto.randomUUID();
  const error = reason instanceof Error ? reason : null;
  const payload: RendererDiagnostic = {
    kind,
    eventId,
    occurredAt: new Date().toISOString(),
    name: error?.name,
    message: safeMessage(error?.message ?? reason),
    stack: error?.stack?.slice(0, 8000),
    route: `${location.pathname}${location.hash}`.slice(0, 500),
    ...extra,
  };
  void window.exva?.diagnostics
    .reportRendererError(payload)
    .catch(() => undefined);
  return eventId;
}

export function installRendererDiagnostics(): void {
  window.addEventListener("error", (event) => {
    report("error", event.error ?? event.message);
  });
  window.addEventListener("unhandledrejection", (event) => {
    report("unhandled_rejection", event.reason);
  });
}

export function reportRendererBootstrapFailure(reason: unknown): string {
  return report("bootstrap_error", reason);
}

export function reportReactError(
  error: Error,
  componentStack?: string | null,
): string {
  return report("react_error_boundary", error, {
    componentStack: componentStack?.slice(0, 8000),
  });
}

function safeMessage(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 1000);
  if (value == null) return "Unknown renderer error";
  if (typeof value === "object")
    return "Renderer rejected with a non-Error object";
  return String(value).slice(0, 1000);
}
