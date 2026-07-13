import type { DbClient } from "../db/client";
import { AppError } from "@electron/shared/infra/errors";
import type {
  ResearchPosturePreset,
  RiskPreset,
  TimeframePreset,
  TradeRulesPreset,
} from "@electron/shared/domain";
import {
  findResearchPosturePresetById,
  findRiskPresetById,
  findTimeframePresetById,
  findTradeRulePresetById,
} from "@electron/shared/presets";
import { requireExperience } from "./index";

export function loadExperiencePresetBundle(
  _client: DbClient,
  experienceId: string,
): {
  posturePreset: ResearchPosturePreset;
  rulesPreset: TradeRulesPreset;
  riskPreset: RiskPreset;
  timeframePreset: TimeframePreset;
} {
  const experience = requireExperience(experienceId);
  const { defaultPresets } = experience;

  const posturePreset = findResearchPosturePresetById(
    defaultPresets.posturePresetId as ResearchPosturePreset["id"],
  );
  if (!posturePreset) {
    throw new AppError(
      `Posture preset '${defaultPresets.posturePresetId}' not found for experience '${experienceId}'`,
      "INTERNAL_ERROR",
    );
  }

  const rulesPreset = findTradeRulePresetById(
    defaultPresets.rulesPresetId as TradeRulesPreset["id"],
  );
  if (!rulesPreset) {
    throw new AppError(
      `Rules preset '${defaultPresets.rulesPresetId}' not found for experience '${experienceId}'`,
      "INTERNAL_ERROR",
    );
  }

  const riskPreset = findRiskPresetById(
    defaultPresets.riskPresetId as RiskPreset["id"],
  );
  if (!riskPreset) {
    throw new AppError(
      `Risk preset '${defaultPresets.riskPresetId}' not found for experience '${experienceId}'`,
      "INTERNAL_ERROR",
    );
  }

  const timeframePreset = findTimeframePresetById(
    defaultPresets.timeframePresetId as TimeframePreset["id"],
  );
  if (!timeframePreset) {
    throw new AppError(
      `Timeframe preset '${defaultPresets.timeframePresetId}' not found for experience '${experienceId}'`,
      "INTERNAL_ERROR",
    );
  }

  return {
    posturePreset,
    rulesPreset,
    riskPreset,
    timeframePreset,
  };
}
