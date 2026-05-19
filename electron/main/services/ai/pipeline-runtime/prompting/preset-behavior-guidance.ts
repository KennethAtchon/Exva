import type { PipelinePhase } from "@electron/shared/ai/pipeline-phase";
import type { PresetAiGuidance, PresetPhaseAiGuidance, SessionStrategyContext } from "@electron/shared/domain";
import {
  findBuiltInGlobalStrategyPresetByExactMatch,
  findResearchPosturePresetById,
  findRiskPresetById,
  findTimeframePresetById,
  findTradeRulePresetById,
} from "@electron/shared/presets";

interface GuidanceSource {
  label: string;
  summary: string | null;
  guidance?: PresetAiGuidance;
}

export function buildPresetBehaviorGuidance(strategyContext: SessionStrategyContext, phase: PipelinePhase): string {
  const { researchPosture, rules, riskConfig, timeframe } = strategyContext;
  const posturePreset = findResearchPosturePresetById(researchPosture.posturePresetId);
  const rulesPreset = findTradeRulePresetById(rules.rulesPresetId);
  const riskPreset = findRiskPresetById(riskConfig.riskPresetId);
  const timeframePreset = findTimeframePresetById(timeframe.timeframePresetId);
  const globalPreset = findBuiltInGlobalStrategyPresetByExactMatch({
    posturePresetId: researchPosture.posturePresetId,
    rulesPresetId: rules.rulesPresetId,
    riskPresetId: riskConfig.riskPresetId,
    timeframePresetId: timeframe.timeframePresetId,
  });

  const sourceCandidates: Array<GuidanceSource | null> = [
    globalPreset
      ? {
          label: `Global preset: ${globalPreset.label}`,
          summary: globalPreset.description,
          guidance: globalPreset.aiGuidance,
        }
      : null,
    posturePreset
      ? {
          label: `Research posture: ${posturePreset.label}`,
          summary: posturePreset.thesis,
          guidance: posturePreset.aiGuidance,
        }
      : null,
    rulesPreset
      ? {
          label: `Trade rules: ${rulesPreset.label}`,
          summary: rulesPreset.thesis,
          guidance: rulesPreset.aiGuidance,
        }
      : null,
    riskPreset
      ? {
          label: `Risk preset: ${riskPreset.label}`,
          summary: riskPreset.description,
          guidance: riskPreset.aiGuidance,
        }
      : null,
    timeframePreset
      ? {
          label: `Timeframe preset: ${timeframePreset.label}`,
          summary: timeframePreset.description,
          guidance: timeframePreset.aiGuidance,
        }
      : null,
  ];
  const sources = sourceCandidates.filter((source): source is GuidanceSource => source != null);

  const sections = sources
    .map((source) => renderSourceGuidance(source, phase))
    .filter((section): section is string => Boolean(section));

  if (sections.length === 0) return "";

  return ["## Preset behavior guidance", ...sections].join("\n\n");
}

function renderSourceGuidance(source: GuidanceSource, phase: PipelinePhase): string | null {
  const phaseGuidance = mergePhaseGuidance(source.guidance, phase);
  if (!phaseGuidance) return null;

  const lines = [
    `### ${source.label}`,
    source.summary ? `- Summary: ${source.summary}` : null,
    phaseGuidance.objective ? `- Objective: ${phaseGuidance.objective}` : null,
    ...renderList("What to look for", phaseGuidance.whatToLookFor),
    ...renderList("How to evaluate", phaseGuidance.howToEvaluate),
    ...renderList("Avoid", phaseGuidance.avoid),
  ].filter((line): line is string => line != null);

  return lines.length > 1 ? lines.join("\n") : null;
}

function mergePhaseGuidance(guidance: PresetAiGuidance | undefined, phase: PipelinePhase): PresetPhaseAiGuidance | null {
  if (!guidance) return null;
  const merged = mergeGuidanceBlocks(guidance.shared, guidance[phase]);
  return hasGuidance(merged) ? merged : null;
}

function mergeGuidanceBlocks(
  shared: PresetPhaseAiGuidance | undefined,
  phaseSpecific: PresetPhaseAiGuidance | undefined,
): PresetPhaseAiGuidance {
  return {
    objective: phaseSpecific?.objective ?? shared?.objective,
    whatToLookFor: [...(shared?.whatToLookFor ?? []), ...(phaseSpecific?.whatToLookFor ?? [])],
    howToEvaluate: [...(shared?.howToEvaluate ?? []), ...(phaseSpecific?.howToEvaluate ?? [])],
    avoid: [...(shared?.avoid ?? []), ...(phaseSpecific?.avoid ?? [])],
  };
}

function hasGuidance(guidance: PresetPhaseAiGuidance): boolean {
  return Boolean(
    guidance.objective ||
      guidance.whatToLookFor?.length ||
      guidance.howToEvaluate?.length ||
      guidance.avoid?.length,
  );
}

function renderList(label: string, items: string[] | undefined): string[] {
  if (!items?.length) return [];
  return [`- ${label}:`, ...items.map((item) => `  - ${item}`)];
}
