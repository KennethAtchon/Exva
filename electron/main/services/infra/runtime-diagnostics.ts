import type { AppServices } from "../app-services";
import { resolveRuntimeFingerprint } from "../../runtime-fingerprint";
import { createLogger } from "./log";
import { getBootId } from "./telemetry-context";

const logger = createLogger("runtime-diagnostics");

export type RuntimeDiagnosticKind =
  | "render_process_gone"
  | "child_process_gone"
  | "did_fail_load"
  | "preload_error"
  | "window_unresponsive"
  | "window_responsive"
  | "renderer_error"
  | "renderer_unhandled_rejection"
  | "react_error_boundary"
  | "renderer_bootstrap_error"
  | "utility_error"
  | "utility_exit";

export function sanitizeDiagnosticText(
  value: unknown,
  maxLength = 1000,
): string {
  const text = String(value ?? "")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]")
    .replace(
      /\b(sk-|ghp_|github_pat_|xox[a-z]-)[A-Za-z0-9_-]+/gi,
      "$1[REDACTED]",
    )
    .replace(
      /\b(api[-_]?key|secret|token|password|authorization)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[REDACTED]",
    )
    .replace(/file:\/\/\/[^\s)]+/g, "<app-file>");
  return text.slice(0, maxLength);
}

export function recordRuntimeDiagnostic(input: {
  kind: RuntimeDiagnosticKind;
  detail: Record<string, unknown>;
  services?: { repos: Pick<AppServices["repos"], "events"> } | null;
  sessionId?: string | null;
  severity?: "INFO" | "WARN" | "ERROR" | "CRITICAL";
  eventId?: string;
}): string {
  const eventId = input.eventId ?? crypto.randomUUID();
  const severity = input.severity ?? "ERROR";
  const fingerprint = resolveRuntimeFingerprint();
  const envelope = {
    schemaVersion: 1,
    eventId,
    eventName: `runtime.${input.kind}`,
    bootId: getBootId(),
    occurredAt: new Date().toISOString(),
    severity,
    process: {
      pid: process.pid,
      platform: process.platform,
      arch: process.arch,
      electronVersion: process.versions.electron ?? null,
      nodeVersion: process.versions.node,
    },
    build: fingerprint,
    detail: sanitizeDiagnosticValue(input.detail),
  };

  try {
    const method =
      severity === "INFO" ? "info" : severity === "WARN" ? "warn" : "error";
    logger[method](
      { runtimeDiagnostic: envelope },
      input.kind.replaceAll("_", " "),
    );
  } catch {
    // Diagnostics must never become a second failure.
  }

  try {
    input.services?.repos.events.insert({
      id: eventId,
      session_id: input.sessionId ?? null,
      trade_id: null,
      cycle_id: null,
      level: severity,
      agent_type: null,
      message: `Runtime diagnostic ${input.kind} incident=${eventId} boot=${getBootId()}`,
      created_at: envelope.occurredAt,
    });
  } catch {
    // The structured log remains the fallback when SQLite is unavailable.
  }

  return eventId;
}

function sanitizeDiagnosticValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[TRUNCATED]";
  if (typeof value === "string") return sanitizeDiagnosticText(value, 8000);
  if (Array.isArray(value))
    return value
      .slice(0, 50)
      .map((item) => sanitizeDiagnosticValue(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value).slice(0, 100)) {
    if (
      /(key|secret|token|password|authorization|cookie|credential)/i.test(key)
    ) {
      result[key] = "[REDACTED]";
    } else {
      result[key] = sanitizeDiagnosticValue(child, depth + 1);
    }
  }
  return result;
}
