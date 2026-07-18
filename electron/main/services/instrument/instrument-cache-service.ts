import type { WorkspaceSession } from "@/lib/types";
import type { InstrumentCacheRepo } from "../../db/repositories/market/instrument-cache-repo";
import {
  buildSelectorDefinitionFingerprint,
  hashSelectorDefinition,
} from "../pipeline/engines/cache/selector-instrument-cache";
import type { OrchestratorDeps } from "../session/session-types";
import { safeJsonParse } from "../infra/safe-json-parse";

export type InstrumentCacheView = {
  instruments: Array<{ symbol: string; instrumentClass: string }> | null;
  selectedAt: string | null;
  definitionHashMatches: boolean;
};

export class InstrumentCacheService {
  constructor(
    private readonly repo: InstrumentCacheRepo,
    private readonly getOrchestratorDeps: () => OrchestratorDeps,
  ) {}

  getView(session: WorkspaceSession): InstrumentCacheView {
    const deps = this.getOrchestratorDeps();
    const currentHash = hashSelectorDefinition(
      buildSelectorDefinitionFingerprint(session, deps),
    );
    const row = this.repo.get(session.id);
    if (!row) {
      return {
        instruments: null,
        selectedAt: null,
        definitionHashMatches: true,
      };
    }
    const instruments = safeJsonParse<
      Array<{ symbol: string; instrumentClass: string }>
    >(row.instruments, undefined, "instrument-cache-service");
    return {
      instruments: Array.isArray(instruments) ? instruments : null,
      selectedAt: row.selectedAt,
      definitionHashMatches: row.definitionHash === currentHash,
    };
  }

  clear(sessionId: string): void {
    this.repo.clear(sessionId);
  }
}
