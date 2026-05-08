import type { SessionConfig, WorkspaceSession } from "@/lib/types";
import type { AgentOrchestrator } from "./agent-orchestrator";
import { MarketHoursService, type BurstInstrument } from "./market-hours-service";

export class ResearchBurstService {
  constructor(
    private readonly orchestrator: AgentOrchestrator,
    private readonly marketHours = new MarketHoursService(),
  ) {}

  async resolve(session: WorkspaceSession, config: SessionConfig): Promise<BurstInstrument[]> {
    const resolvedInstruments = await this.orchestrator.resolveInstrumentsForBurst(session, config);
    return this.marketHours.filterTradable(resolvedInstruments);
  }
}
