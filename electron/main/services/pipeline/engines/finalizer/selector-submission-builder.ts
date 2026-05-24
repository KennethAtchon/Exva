import type { InstrumentSelection } from "@/lib/schemas";
import { buildInstrumentSelection } from "../../../signal/scoring/selector-submission-builder";
import { summarizeWorkerToolCoverage } from "../../execution/worker-tool-requirements";
import {
  registerEngine,
  type FinalizerEngine,
  type PhaseWorkerResult,
} from "../registry";
import type { SelectorRiskFilterFinalizerResult } from "./selector-risk-filter";

const selectorSubmissionBuilderEngine: FinalizerEngine<
  SelectorRiskFilterFinalizerResult,
  InstrumentSelection
> = {
  id: "selector-submission-builder",
  kind: "finalizer",
  async run(ctx, evaluationResult, workerResults) {
    return {
      ...buildInstrumentSelection(
        evaluationResult.accepted,
        ctx.strategyContext.riskConfig.maxConcurrentTrades,
      ),
      diagnostics: {
        discoveredCount: evaluationResult.discoveredCount,
        verifiedCount: evaluationResult.verifiedCount,
        acceptedCount: evaluationResult.accepted.length,
        rejected: evaluationResult.rejected,
        workerToolCoverage: buildWorkerToolCoverage(workerResults),
      },
    };
  },
};

function buildWorkerToolCoverage(workerResults: PhaseWorkerResult[]) {
  return workerResults.map(({ worker, result }) => {
    const usedTools = parseWorkerToolNames(result.message.tool_calls_json);
    const workerPrefix = worker.id.split(":")[0] ?? worker.id;
    const requirement = worker.toolRequirements ?? resolveToolRequirementForWorker(workerPrefix);
    return summarizeWorkerToolCoverage(worker.id, requirement, usedTools);
  });
}

function parseWorkerToolNames(raw: string | null): string[] {
  const steps = parseWorkerToolTrace(raw);
  return [
    ...new Set(
      steps.flatMap((step) => step.toolCalls.map((call) => call.tool)),
    ),
  ];
}

function parseWorkerToolTrace(raw: string | null): Array<{
  step: number;
  toolCalls: Array<{
    step: number;
    tool: string;
    argsJson: string;
    resultJson: string;
  }>;
}> {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Array<{
      step: number;
      toolCalls?: Array<{
        step: number;
        tool: string;
        argsJson: string;
        resultJson: string;
      }>;
    }>;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((step) => ({
      step: step.step,
      toolCalls: step.toolCalls ?? [],
    }));
  } catch {
    return [];
  }
}

function resolveToolRequirementForWorker(workerPrefix: string) {
  if (workerPrefix === "market-validator") {
    return { requiredAll: ["get_quote", "get_ohlcv"], minToolCalls: 2 } as const;
  }
  if (workerPrefix === "liquidity-gate") {
    return { requiredAll: ["get_quote"], minToolCalls: 1 } as const;
  }
  if (workerPrefix === "catalyst-extractor") {
    return {
      requiredAny: ["get_news", "search_web", "fetch_url"],
      minToolCalls: 1,
    } as const;
  }
  if (workerPrefix === "web-scout") {
    return { requiredAll: ["search_web"], minToolCalls: 1 } as const;
  }
  if (workerPrefix === "reddit-scout") {
    return { requiredAll: ["search_reddit"], minToolCalls: 1 } as const;
  }
  if (workerPrefix === "trend-scout") {
    return { requiredAll: ["get_trending_symbols"], minToolCalls: 1 } as const;
  }
  return undefined;
}

registerEngine(selectorSubmissionBuilderEngine);
