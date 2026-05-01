import type { WorkspaceSession } from "@/lib/types";
import type { OrchestratorDeps, PreflightResult } from "../session-types";

export async function instrumentConflictCheck(
  session: WorkspaceSession,
  deps: OrchestratorDeps,
): Promise<PreflightResult> {
  if (session.selectionMode !== "manual_shortlist") return { ok: true };

  // TODO(phase-08): Resolve the actual broker account per instrument class from broker routing
  // instead of using the compatibility default broker placeholder.
  const brokerAccountId = "default-broker";

  const symbols = session.instrumentScope
    .split(",")
    .map((symbol) => symbol.trim())
    .filter((symbol) => symbol.length > 0);

  for (const symbol of symbols) {
    if (deps.tradesRepo.checkInstrumentConflict(brokerAccountId, symbol, session.id)) {
      return {
        ok: false,
        code: "INSTRUMENT_CONFLICT",
        message: `Another active session already holds ${symbol}.`,
        details: { symbol },
      };
    }
  }

  return { ok: true };
}
