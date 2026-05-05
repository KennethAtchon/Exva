import type { SessionRiskConfigRepo } from "../../db/repositories/session-risk-config-repo";
import type { SessionStrategyProfileRepo } from "../../db/repositories/session-strategy-profile-repo";
import type { SessionTimeframeConfigRepo } from "../../db/repositories/session-timeframe-config-repo";
import type { SessionStrategyContext } from "@/lib/types";

export class SessionStrategyContextService {
  constructor(
    private readonly profileRepo: SessionStrategyProfileRepo,
    private readonly riskRepo: SessionRiskConfigRepo,
    private readonly timeframeRepo: SessionTimeframeConfigRepo,
  ) {}

  get(sessionId: string): SessionStrategyContext {
    return {
      profile: this.profileRepo.get(sessionId),
      riskConfig: this.riskRepo.get(sessionId),
      timeframe: this.timeframeRepo.get(sessionId),
    };
  }
}
