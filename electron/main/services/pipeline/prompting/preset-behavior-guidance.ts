import type { PipelinePhase } from "@electron/shared/ai/pipeline-phase";
import type {
  StrategyGuidanceField,
  StrategyContextField,
  WorkerStrategyContextRequest,
} from "@electron/shared/ai/pipeline-phase";
import type {
  PresetAiGuidance,
  PresetPhaseAiGuidance,
  SessionStrategyContext,
} from "@electron/shared/domain";
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
  field: StrategyContextField;
}

type GuidanceSourceDescriptor = {
  field: StrategyContextField;
  resolve: (context: SessionStrategyContext) => GuidanceSource | null;
};

type GuidanceSectionDescriptor = {
  field: StrategyGuidanceField;
  render: (
    guidance: PresetPhaseAiGuidance,
    maxItems: number | undefined,
  ) => string[];
};

const GUIDANCE_SOURCE_DESCRIPTORS = [
  {
    field: "identity",
    resolve: ({ researchPosture, rules, riskConfig, timeframe }) => {
      const preset = findBuiltInGlobalStrategyPresetByExactMatch({
        posturePresetId: researchPosture.posturePresetId,
        rulesPresetId: rules.rulesPresetId,
        riskPresetId: riskConfig.riskPresetId,
        timeframePresetId: timeframe.timeframePresetId,
      });
      return preset
        ? {
            label: `Global preset: ${preset.label}`,
            summary: preset.description,
            guidance: preset.aiGuidance,
            field: "identity",
          }
        : null;
    },
  },
  {
    field: "researchPosture",
    resolve: ({ researchPosture }) => {
      const preset = findResearchPosturePresetById(
        researchPosture.posturePresetId,
      );
      return preset
        ? {
            label: `Research posture: ${preset.label}`,
            summary: preset.thesis,
            guidance: preset.aiGuidance,
            field: "researchPosture",
          }
        : null;
    },
  },
  {
    field: "tradeRules",
    resolve: ({ rules }) => {
      const preset = findTradeRulePresetById(rules.rulesPresetId);
      return preset
        ? {
            label: `Trade rules: ${preset.label}`,
            summary: preset.thesis,
            guidance: preset.aiGuidance,
            field: "tradeRules",
          }
        : null;
    },
  },
  {
    field: "riskLimits",
    resolve: ({ riskConfig }) => {
      const preset = findRiskPresetById(riskConfig.riskPresetId);
      return preset
        ? {
            label: `Risk preset: ${preset.label}`,
            summary: preset.description,
            guidance: preset.aiGuidance,
            field: "riskLimits",
          }
        : null;
    },
  },
  {
    field: "timeframe",
    resolve: ({ timeframe }) => {
      const preset = findTimeframePresetById(timeframe.timeframePresetId);
      return preset
        ? {
            label: `Timeframe preset: ${preset.label}`,
            summary: preset.description,
            guidance: preset.aiGuidance,
            field: "timeframe",
          }
        : null;
    },
  },
] satisfies readonly GuidanceSourceDescriptor[];

const GUIDANCE_SECTION_DESCRIPTORS: readonly GuidanceSectionDescriptor[] = [
  {
    field: "objective",
    render: (guidance) =>
      guidance.objective ? [`- Objective: ${guidance.objective}`] : [],
  },
  {
    field: "whatToLookFor",
    render: (guidance, maxItems) =>
      renderList("What to look for", guidance.whatToLookFor, maxItems),
  },
  {
    field: "howToEvaluate",
    render: (guidance, maxItems) =>
      renderList("How to evaluate", guidance.howToEvaluate, maxItems),
  },
  {
    field: "avoid",
    render: (guidance, maxItems) =>
      renderList("Avoid", guidance.avoid, maxItems),
  },
];

export function buildPresetBehaviorGuidance(
  strategyContext: SessionStrategyContext,
  phase: PipelinePhase,
  request?: WorkerStrategyContextRequest,
): string {
  if (request && !request.fields.includes("presetBehavior")) return "";
  const requestedFields = request ? new Set(request.fields) : null;
  const sources = resolveGuidanceSources(strategyContext).filter((source) =>
    shouldIncludeSource(source, requestedFields),
  );

  const sections = sources
    .map((source) => renderSourceGuidance(source, phase, request))
    .filter((section): section is string => Boolean(section));

  if (sections.length === 0) return "";

  return ["## Preset behavior guidance", ...sections].join("\n\n");
}

function renderSourceGuidance(
  source: GuidanceSource,
  phase: PipelinePhase,
  request?: WorkerStrategyContextRequest,
): string | null {
  const phaseGuidance = mergePhaseGuidance(source.guidance, phase);
  if (!phaseGuidance) return null;
  const guidanceFields = request ? new Set(request.guidance) : null;

  const lines = [
    `### ${source.label}`,
    source.summary ? `- Summary: ${source.summary}` : null,
    ...GUIDANCE_SECTION_DESCRIPTORS.filter(
      (section) => !guidanceFields || guidanceFields.has(section.field),
    ).flatMap((section) =>
      section.render(phaseGuidance, request?.maxGuidanceItems),
    ),
  ].filter((line): line is string => line != null);

  return lines.length > 1 ? lines.join("\n") : null;
}

function resolveGuidanceSources(
  context: SessionStrategyContext,
): GuidanceSource[] {
  const sources: Array<GuidanceSource | null> = GUIDANCE_SOURCE_DESCRIPTORS.map(
    (descriptor) => descriptor.resolve(context),
  );
  return sources.filter(isGuidanceSource);
}

function isGuidanceSource(
  source: GuidanceSource | null,
): source is GuidanceSource {
  return source != null;
}

function shouldIncludeSource(
  source: GuidanceSource,
  requestedFields: ReadonlySet<StrategyContextField> | null,
): boolean {
  if (!requestedFields) return true;
  return (
    requestedFields.has(source.field) ||
    (source.field === "identity" && requestedFields.has("presetBehavior"))
  );
}

function mergePhaseGuidance(
  guidance: PresetAiGuidance | undefined,
  phase: PipelinePhase,
): PresetPhaseAiGuidance | null {
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
    whatToLookFor: [
      ...(shared?.whatToLookFor ?? []),
      ...(phaseSpecific?.whatToLookFor ?? []),
    ],
    howToEvaluate: [
      ...(shared?.howToEvaluate ?? []),
      ...(phaseSpecific?.howToEvaluate ?? []),
    ],
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

function renderList(
  label: string,
  items: string[] | undefined,
  maxItems?: number,
): string[] {
  if (!items?.length) return [];
  const renderedItems = maxItems ? items.slice(0, maxItems) : items;
  return [`- ${label}:`, ...renderedItems.map((item) => `  - ${item}`)];
}
