import type { SessionConfig, WorkspaceSession } from "@/lib/types";
import { AppError } from "@electron/shared/errors";
import type { AgentOrchestrator } from "./agent-orchestrator";
import { MarketHoursService, type BurstInstrument } from "./market-hours-service";

export class ResearchBurstService {
  constructor(
    private readonly orchestrator: AgentOrchestrator,
    private readonly marketHours = new MarketHoursService(),
  ) {}

  async resolve(session: WorkspaceSession, config: SessionConfig): Promise<BurstInstrument[]> {
    const instruments = await this.orchestrator.resolveInstrumentsForBurst(session, config);
    const tradable = this.marketHours.filterTradable(instruments);
    if (tradable.length === 0) {
      throw new AppError("Research burst produced no tradable instruments.", "VALIDATION_FAILED");
    }
    return tradable;
  }
}
