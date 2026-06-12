import { eq } from "drizzle-orm";
import type { DbClient } from "../db/client";
import {
  researchPosturePresets,
  riskPresets,
  timeframePresets,
  tradeRulePresets,
} from "../db/schema";
import { AppError } from "@electron/shared/infra/errors";
import type {
  ResearchPosturePreset,
  RiskPreset,
  TimeframePreset,
  TradeRulesPreset,
} from "@electron/shared/domain";
import { requireExperience } from "./index";

export function loadExperiencePresetBundle(
  client: DbClient,
  experienceId: string,
): {
  posturePreset: ResearchPosturePreset;
  rulesPreset: TradeRulesPreset;
  riskPreset: RiskPreset;
  timeframePreset: TimeframePreset;
} {
  const experience = requireExperience(experienceId);
  const { presets } = experience;

  const postureRow = client.db
    .select()
    .from(researchPosturePresets)
    .where(eq(researchPosturePresets.id, presets.posturePresetId))
    .get();
  if (!postureRow) {
    throw new AppError(
      `Posture preset '${presets.posturePresetId}' not found for experience '${experienceId}'`,
      "INTERNAL_ERROR",
    );
  }

  const rulesRow = client.db
    .select()
    .from(tradeRulePresets)
    .where(eq(tradeRulePresets.id, presets.rulesPresetId))
    .get();
  if (!rulesRow) {
    throw new AppError(
      `Rules preset '${presets.rulesPresetId}' not found for experience '${experienceId}'`,
      "INTERNAL_ERROR",
    );
  }

  const riskRow = client.db
    .select()
    .from(riskPresets)
    .where(eq(riskPresets.id, presets.riskPresetId))
    .get();
  if (!riskRow) {
    throw new AppError(
      `Risk preset '${presets.riskPresetId}' not found for experience '${experienceId}'`,
      "INTERNAL_ERROR",
    );
  }

  const timeframeRow = client.db
    .select()
    .from(timeframePresets)
    .where(eq(timeframePresets.id, presets.timeframePresetId))
    .get();
  if (!timeframeRow) {
    throw new AppError(
      `Timeframe preset '${presets.timeframePresetId}' not found for experience '${experienceId}'`,
      "INTERNAL_ERROR",
    );
  }

  return {
    posturePreset: JSON.parse(postureRow.presetJson) as ResearchPosturePreset,
    rulesPreset: JSON.parse(rulesRow.presetJson) as TradeRulesPreset,
    riskPreset: JSON.parse(riskRow.presetJson) as RiskPreset,
    timeframePreset: JSON.parse(timeframeRow.presetJson) as TimeframePreset,
  };
}
