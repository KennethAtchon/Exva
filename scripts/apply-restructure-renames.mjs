#!/usr/bin/env bun
/**
 * Commit B — apply all symbol renames from folder-restructure-plan.md.
 * Run: bun scripts/apply-restructure-renames.mjs
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

const SCAN_DIRS = ["electron", "src"];
const SCAN_DOCS = [
  "docs/architecture/ai-runtime.md",
  "docs/architecture/pipeline-runtime.md",
  "docs/folder-structure.md",
  "docs/plans/folder-restructure-plan.md",
];

/** Longest-first to avoid partial replacements. */
const SYMBOL_RENAMES = [
  ["PhasePlanInterpreterRunInput", "AIPhaseRunInput"],
  ["CyclePlanInterpreterRunInput", "InstrumentAnalysisRunInput"],
  ["DEFAULT_TERMINAL_TOOL_DESCRIPTION", "DEFAULT_SUBMIT_TOOL_DESCRIPTION"],
  ["UnifiedPlanInspectMetadata", "AnalysisInspectMetadata"],
  ["CyclePlanInspectMetadata", "InstrumentAnalysisMetadata"],
  ["PhasePlanInspectMetadata", "AIPhaseMetadata"],
  ["ResolvedWorkerRuntimeConfig", "WorkerExecConfig"],
  ["WorkerGraphScheduleResult", "AIWorkerSchedule"],
  ["registerDefaultCyclePlans", "registerDefaultInstrumentAnalyses"],
  ["registerDefaultPhasePlans", "registerDefaultAIPhases"],
  ["resolveStructuredWorkerOutput", "parseWorkerOutput"],
  ["StructuredOutputAttempt", "WorkerOutputAttempt"],
  ["extractTerminalSubmission", "extractWorkerSubmission"],
  ["TerminalOutputToolSpec", "SubmitOutputToolSpec"],
  ["HarnessToolAvailability", "WorkerToolAvailability"],
  ["CyclePlanInterpreter", "InstrumentAnalysisRunner"],
  ["PhasePlanInterpreter", "AIPhaseRunner"],
  ["CycleStageFailedError", "AnalysisStepFailedError"],
  ["registerPipelineEngines", "registerTradeSignalEngines"],
  ["buildPresetBehaviorGuidance", "buildStrategyGuidance"],
  ["EngineContextRunInput", "EngineInjectionInput"],
  ["PipelineSpendTrackerOptions", "AISpendTrackerOptions"],
  ["UnifiedPlanDefinition", "AnyAnalysisDefinition"],
  ["TradeCyclePlanState", "InstrumentAnalysisState"],
  ["PhasePlanWorkerTrace", "AIWorkerTrace"],
  ["WorkerOutputContract", "AIWorkerOutputSchema"],
  ["PipelineWorkerRunner", "AIWorkerRunner"],
  ["buildCycleStageExecute", "buildAnalysisStepExecute"],
  ["CyclePlanRunContext", "InstrumentAnalysisContext"],
  ["ToolContextBuilderDeps", "WorkerToolResolverDeps"],
  ["RiskFilterEvaluation", "SelectorRiskFilterResult"],
  ["ExecutionProfileInput", "TradeExecutionProfileInput"],
  ["computeExecutionProfile", "computeTradeExecutionProfile"],
  ["PhaseConfigResolver", "AIPhaseConfigResolver"],
  ["AnyEngineDefinition", "AnySignalEngine"],
  ["EngineRunContext", "SignalEngineContext"],
  ["EngineDefinition", "SignalEngineDefinition"],
  ["CyclePlanServices", "InstrumentAnalysisServices"],
  ["PhasePlanServices", "AIPhaseServices"],
  ["ExecutionStepRunner", "TradingStepRunner"],
  ["OrchestratorContext", "TradingCycleContext"],
  ["PromptEnvelopeSizeReport", "PromptSizeReport"],
  ["TradePipelineResult", "InstrumentAnalysisResult"],
  ["buildWorkerSchedule", "scheduleWorkersByDependency"],
  ["PipelineSpendTracker", "AISpendTracker"],
  ["WorkerExecutorDeps", "AIWorkerRunnerDeps"],
  ["PhasePlanRunContext", "AIPhaseContext"],
  ["PhasePlanRunResult", "AIPhaseResult"],
  ["RuntimeAgentMessage", "LLMMessage"],
  ["ProviderRetryContext", "LLMRetryContext"],
  ["CyclePlanStage", "AnalysisStep"],
  ["CycleStepRunner", "AnalysisStepRunner"],
  ["CyclePausedError", "AnalysisPausedError"],
  ["runReadEngineContext", "injectEngineResults"],
  ["runDeclarativeStage", "runAnalysisStep"],
  ["runConcurrentGroup", "runWorkersConcurrently"],
  ["executeByFrontier", "runWorkerBatches"],
  ["inspectUnifiedPlan", "inspectAnalysis"],
  ["listUnifiedPlanIds", "listAnalysisIds"],
  ["requireUnifiedPlan", "requireAnalysis"],
  ["resolveUnifiedPlan", "resolveAnalysis"],
  ["registerCyclePlan", "registerInstrumentAnalysis"],
  ["registerPhasePlan", "registerAIPhase"],
  ["registerEngine", "registerSignalEngine"],
  ["mergeCandidates", "mergeDiscoveryCandidates"],
  ["WorkingCandidate", "SelectorCandidate"],
  ["measurePromptEnvelope", "measureWorkerPrompt"],
  ["buildPromptEnvelope", "buildWorkerPrompt"],
  ["buildToolContext", "resolveWorkerToolContext"],
  ["PromptEnvelopeInput", "WorkerPromptInput"],
  ["withProviderRetry", "withLLMRetry"],
  ["buildTraceMessage", "buildLLMTraceMessage"],
  ["StepTrace", "LLMToolStepTrace"],
  ["ToolCallRecord", "LLMToolCall"],
  ["executeWorker", "runAIWorker"],
  ["WorkerRunOptions", "AIWorkerRunOptions"],
  ["WorkerGraphNode", "AIWorkerNode"],
  ["ToolBuildContext", "WorkerToolContext"],
  ["buildToolSet", "buildWorkerTools"],
  ["runEngineBinding", "runEngineForWorker"],
  ["SpendCapExceeded", "SpendCapExceededError"],
  ["SpendCapKind", "SpendCapLevel"],
  ["PhasePlanStage", "AIWorkerBatch"],
  ["PhaseEntryMode", "AIPhaseEntryMode"],
  ["PhasePlanSource", "AIPhaseSource"],
  ["toRunFromTrace", "traceToRunRecord"],
  ["AgentResult", "LLMRunResult"],
  ["getCyclePlan", "getInstrumentAnalysis"],
  ["getPhasePlan", "getAIPhase"],
  ["getEngine", "getSignalEngine"],
  ["PhaseTraceV1", "AIPhaseTrace"],
  ["PipelineRunContext", "AIPhaseRunContext"],
  ["RiskFilterDeps", "SelectorRiskFilterDeps"],
  ["ExecutionProfile", "TradeExecutionProfile"],
  ["PlanInterpreter", "AnalysisDispatcher"],
  ["StepRunnerDeps", "TradingStepRunnerDeps"],
  ["StepRunOptions", "TradingStepRunOptions"],
  ["ScheduledRetry", "StepRetrySchedule"],
  ["RunTrace", "LLMCallTrace"],
  ["PromptEnvelope", "WorkerPromptMessages"],
  ["RiskFilter", "SelectorRiskFilter"],
  ["CyclePlan", "InstrumentAnalysis"],
  ["PhasePlan", "AIPhase"],
  ["PlanKind", "AnalysisKind"],
  ["AiRuntime", "LLMRuntime"],
];

const IMPORT_PATH_RENAMES = [
  ["@electron/shared/ai/pipeline-config", "@electron/shared/ai/ai-phase-config"],
  [
    "@electron/shared/ai/effective-pipeline-config",
    "@electron/shared/ai/effective-ai-phase-config",
  ],
  [
    "@electron/shared/ai/pipeline-observability",
    "@electron/shared/ai/ai-phase-trace",
  ],
  ["@electron/shared/ai/pipeline-phase", "@electron/shared/ai/ai-phase"],
  ["@electron/shared/ai/pipeline-signals", "@electron/shared/ai/trade-signals"],
  [
    "@electron/shared/ai/signal-prompt-payload",
    "@electron/shared/ai/worker-prompt-payload",
  ],
  [
    "@electron/shared/ai/selector-pipeline-candidate",
    "@electron/shared/ai/selector-candidate",
  ],
  ["ai-runtime-types", "llm-types"],
  ["pipeline-spend-tracker", "ai-spend-tracker"],
  ["engine-context-runner", "engine-prompt-injector"],
  ["prompt-envelope-builder", "worker-prompt-builder"],
  ["preset-behavior-guidance", "strategy-guidance"],
  ["tool-context-builder", "worker-tool-resolver"],
  ["tool-factory-registry", "worker-tool-factory"],
  ["phase-config-resolver", "ai-phase-config-resolver"],
  ["engine-registry", "signal-engine-registry"],
  ["register-pipeline-engines", "register-trade-signal-engines"],
  ["execution-profile-engine", "trade-execution-profile"],
  ["registry/cycle-plans", "registry/register-analyses"],
  ["registry/phase-plans", "registry/register-phases"],
  ["default-cycle-stages", "default-analysis-steps"],
  ["default-cycle", "default-analysis"],
  ["analysis-plans", "phase-analyses"],
  ["selector/plan", "selector/selector-analysis"],
  ["selector/schemas", "selector/selector-schemas"],
  ["registry/interpreter", "registry/analysis-dispatcher"],
  ["registry/registry", "registry/analysis-resolver"],
  ["registry/types", "registry/analysis-kinds"],
  ["execution-step-runner", "trading-step-runner"],
  ["orchestrator-context", "trading-cycle-context"],
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "drizzle") continue;
      walk(p, out);
    } else if (/\.(ts|tsx|md)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

function applyRenames(content, renames) {
  let next = content;
  for (const [from, to] of renames) {
    if (from === to) continue;
    next = next.split(from).join(to);
  }
  return next;
}

const files = [];
for (const d of SCAN_DIRS) {
  walk(join(ROOT, d), files);
}
for (const doc of SCAN_DOCS) {
  files.push(join(ROOT, doc));
}

let changed = 0;
for (const file of files) {
  const before = readFileSync(file, "utf8");
  let after = applyRenames(before, SYMBOL_RENAMES);
  after = applyRenames(after, IMPORT_PATH_RENAMES);

  // Orchestration StepResult -> TradingStepResult (avoid AI SDK StepResult in other files)
  if (file.includes("orchestration/cycle/") || file.endsWith("orchestration/index.ts")) {
    after = after
      .replace(/export type StepResult</g, "export type TradingStepResult<")
      .replace(/type StepResult</g, "type TradingStepResult<")
      .replace(/StepResult</g, "TradingStepResult<")
      .replace(/Extract<TradingStepResult/g, "Extract<TradingStepResult"); // idempotent
  }

  if (after !== before) {
    writeFileSync(file, after);
    changed++;
    console.log("updated", relative(ROOT, file));
  }
}

console.log(`\nDone. ${changed} files updated.`);
