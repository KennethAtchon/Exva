import type { SessionConfig, WorkspaceSession } from "@/lib/types";
import type { AgentOrchestrator } from "./agent-orchestrator";
import { MarketHoursService, type BurstInstrument } from "./market-hours-service";

export class ResearchBurstService {
  constructor(
    private readonly orchestrator: AgentOrchestrator,
    private readonly marketHours = new MarketHoursService(),
  ) {}

  async resolve(session: WorkspaceSession, config: SessionConfig, cycleId?: string): Promise<BurstInstrument[]> {
    const resolvedInstruments = await this.orchestrator.resolveInstrumentsForBurst(session, config, cycleId);
    return this.marketHours.filterTradable(resolvedInstruments);
  }
}
