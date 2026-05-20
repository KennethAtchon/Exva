import type { DbClient } from "../../client";
import type { SessionRiskConfig } from "@/lib/types";
import { eq } from "drizzle-orm";
import { AppError } from "@electron/shared/infra/errors";
import { sessionRiskConfig } from "../../schema";
import { toSessionRiskConfig } from "../system/mappers";

export class SessionRiskConfigRepo {
  constructor(private readonly client: DbClient) {}

  get(sessionId: string): SessionRiskConfig {
    const row = this.client.db
      .select()
      .from(sessionRiskConfig)
      .where(eq(sessionRiskConfig.sessionId, sessionId))
      .get();
    if (!row) {
      throw new AppError(
        `Risk config for session ${sessionId} was not found`,
        "NOT_FOUND",
        { sessionId },
      );
    }
    return toSessionRiskConfig(row);
  }

  upsert(
    sessionId: string,
    patch: Partial<SessionRiskConfig>,
  ): SessionRiskConfig {
    const current = this.get(sessionId);
    const next: SessionRiskConfig = {
      ...current,
      ...patch,
      sessionId,
      updatedAt: new Date().toISOString(),
    };

    this.client.db
      .update(sessionRiskConfig)
      .set({
        riskPresetId: next.riskPresetId,
        maxPositionUsd: next.maxPositionUsd,
        stopLossPct: next.stopLossPct,
        takeProfitPct: next.takeProfitPct,
        stopLossType: next.stopLossType,
        atrStopMultiplier: next.atrStopMultiplier,
        kellyFraction: next.kellyFraction,
        predictionEdgeThreshold: next.predictionEdgeThreshold,
        maxExposureUsd: next.maxExposureUsd,
        waitForOpenThreshold: next.waitForOpenThreshold,
        maxConcurrentTrades: next.maxConcurrentTrades,
        dailyLossLimitUsd: next.dailyLossLimitUsd,
        profitTargetUsd: next.profitTargetUsd,
        maxAiSpendUsd: next.maxAiSpendUsd,
        maxDataSpendUsd: next.maxDataSpendUsd,
        humanApprovalRequired: next.humanApprovalRequired,
        updatedAt: next.updatedAt,
      })
      .where(eq(sessionRiskConfig.sessionId, sessionId))
      .run();

    return this.get(sessionId);
  }
}
