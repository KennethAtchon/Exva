import { describe, expect, it } from "vitest";
import { aggregateTradeSignal } from "../../signal/aggregators/trade-signal-aggregator";
import {
  scriptedWorkerOutputsForScenario,
  resolveScriptedWorkerOutput,
} from "../../broker/mock/mock-scenario-worker-outputs";
import {
  conflictDetectorOutputSchema,
  riskAssessorOutputSchema,
} from "../../signal/aggregators/review-aggregator";
import {
  entryTimerOutputSchema,
  signalClassifierOutputSchema,
} from "../../signal/aggregators/trade-signal-aggregator";
import { aggregateReviewSignal } from "../../signal/aggregators/review-aggregator";
import {
  adversarialReviewerOutputSchema,
  aggregateAdversarialReview,
  aggregateCatalystTradeSignal,
  catalystAnalystOutputSchema,
} from "../../signal/aggregators/catalyst-two-call-aggregator";

describe("scripted golden path", () => {
  it("clean_breakout 2-call catalyst scripted outputs produce a buy without LLM", () => {
    const outputs = scriptedWorkerOutputsForScenario("clean_breakout", "NVDA");
    const analyst = catalystAnalystOutputSchema.parse(
      resolveScriptedWorkerOutput("catalyst-analyst", outputs),
    );
    const adversarial = adversarialReviewerOutputSchema.parse(
      resolveScriptedWorkerOutput("adversarial-reviewer", outputs),
    );
    const review = aggregateAdversarialReview("NVDA", adversarial);
    const decision = aggregateCatalystTradeSignal("NVDA", analyst, review, {
      waitForOpenThreshold: 0.8,
    });
    expect(decision.action).toBe("buy");
    expect(decision.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("clean_breakout scripted outputs produce a buy decision without LLM", () => {
    const outputs = scriptedWorkerOutputsForScenario("clean_breakout", "NVDA");

    const classifierRaw = resolveScriptedWorkerOutput(
      "signal-classifier",
      outputs,
    );
    const timerRaw = resolveScriptedWorkerOutput("entry-timer", outputs);
    const conflictRaw = resolveScriptedWorkerOutput(
      "conflict-detector",
      outputs,
    );
    const riskRaw = resolveScriptedWorkerOutput("risk-assessor", outputs);

    expect(classifierRaw).toBeDefined();
    expect(timerRaw).toBeDefined();

    const classifier = signalClassifierOutputSchema.parse(classifierRaw);
    const timer = entryTimerOutputSchema.parse(timerRaw);
    const review = aggregateReviewSignal("NVDA", {
      conflictDetector: conflictDetectorOutputSchema.parse(conflictRaw),
      riskAssessor: riskAssessorOutputSchema.parse(riskRaw),
    });

    const decision = aggregateTradeSignal("NVDA", review, classifier, timer, {
      waitForOpenThreshold: 0.8,
    });

    expect(decision.action).toBe("buy");
    expect(decision.confidence).toBeGreaterThanOrEqual(0.8);
    expect(timer.entryTiming).toBe("now");
  });

  it("news_reversal scripted outputs produce review-driven skip", () => {
    const outputs = scriptedWorkerOutputsForScenario("news_reversal", "NVDA");
    const review = aggregateReviewSignal("NVDA", {
      conflictDetector: conflictDetectorOutputSchema.parse(
        resolveScriptedWorkerOutput("conflict-detector", outputs),
      ),
      riskAssessor: riskAssessorOutputSchema.parse(
        resolveScriptedWorkerOutput("risk-assessor", outputs),
      ),
    });

    expect(review.recommendation).not.toBe("proceed");
  });
});
