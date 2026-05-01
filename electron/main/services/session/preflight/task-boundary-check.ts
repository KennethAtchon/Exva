import type { WorkspaceSession } from "@/lib/types";
import type { PreflightResult } from "../session-types";

export async function taskBoundaryCheck(session: WorkspaceSession): Promise<PreflightResult> {
  if (!session.name.trim()) {
    return { ok: false, code: "VALIDATION_FAILED", message: "Session name is required." };
  }
  if (!session.objective.trim()) {
    return { ok: false, code: "VALIDATION_FAILED", message: "Session objective is required." };
  }
  if (session.instrumentClasses.length === 0) {
    return { ok: false, code: "VALIDATION_FAILED", message: "At least one instrument class is required." };
  }
  if (!session.instrumentScope.trim()) {
    return { ok: false, code: "VALIDATION_FAILED", message: "Instrument scope is required." };
  }
  if (session.capitalLimitUsd <= 0) {
    return { ok: false, code: "VALIDATION_FAILED", message: "Capital limit must be greater than zero." };
  }
  if (!session.executionMode) {
    return { ok: false, code: "VALIDATION_FAILED", message: "Execution mode is required." };
  }
  return { ok: true };
}
