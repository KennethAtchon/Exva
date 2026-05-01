import type { WorkspaceSession } from "@/lib/types";
import type { OrchestratorDeps, PreflightStepFailure } from "../session-types";

type StepResult = { ok: true } | PreflightStepFailure;

/** Matches plan: newline- or comma-separated manual shortlist symbols. */
export function parseInstrumentScopeSymbols(scope: string): string[] {
  return scope
    .split(/[\n,]+/)
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);
}

export async function instrumentConflictCheck(session: WorkspaceSession, deps: OrchestratorDeps): Promise<StepResult> {
  if (session.selectionMode !== "manual_shortlist") return { ok: true };

  const symbols = parseInstrumentScopeSymbols(session.instrumentScope);
  if (symbols.length === 0) {
    return {
      ok: false,
      code: "VALIDATION_FAILED",
      message: "Manual shortlist mode requires at least one instrument symbol.",
      details: { field: "instrumentScope" },
    };
  }

  for (const ic of session.instrumentClasses) {
    const brokerAccountId = deps.brokerRoutingRepo.resolveBrokerAccountId(session.id, ic);
    if (!brokerAccountId) {
      return {
        ok: false,
        code: "NO_BROKER",
        message: `Cannot check instrument conflicts: no broker resolved for ${ic}.`,
        details: { instrumentClass: ic },
      };
    }

    for (const symbol of symbols) {
      if (deps.tradesRepo.checkInstrumentConflict(brokerAccountId, symbol, session.id)) {
        return {
          ok: false,
          code: "INSTRUMENT_CONFLICT",
          message: `Another active session already holds ${symbol} on the broker used for ${ic}.`,
          details: { symbol, instrumentClass: ic, brokerAccountId },
        };
      }
    }
  }

  return { ok: true };
}
