import { describe, expect, it } from "vitest";
import type { SessionStrategyContext } from "@electron/shared/domain";
import { buildStrategyPromptContext, prependStrategyContextToUserPrompt } from "../strategy-prompt-context";

function baseContext(): SessionStrategyContext {
  const ts = "2026-05-05T00:00:00.000Z";
  return {
    researchPosture: {
      sessionId: "s1",
      posturePresetId: "trend_hunt",
      discoveryMode: "trend_scan",
      evidenceMode: "price_action_first",
      catalystMode: "preferred",
      fundamentalStrictness: "sanity_check",
      postureNotes: "Favor strong leaders with clean trend persistence.",
      updatedAt: ts,
    },
    aiRoleProfiles: [],
    rules: {
      sessionId: "s1",
      rulesPresetId: "breakout_long",
      setupType: "breakout",
      sideBias: "long_only",
      entryStyle: "breakout",
      exitStyle: "trailing_atr",
      scalingMode: "single_entry",
      tradeRulesMarkdown: "",
      ruleNotes: "Avoid earnings week.",
      updatedAt: "2026-05-05T00:00:00.000Z",
    },
    riskConfig: {
      sessionId: "s1",
      riskPresetId: "custom" as const,
      maxPositionUsd: 100,
      stopLossPct: 2,
      takeProfitPct: 4,
      stopLossType: "fixed_pct",
      atrStopMultiplier: 1.5,
      kellyFraction: 0.25,
      predictionEdgeThreshold: 0.08,
      maxExposureUsd: null,
      waitForOpenThreshold: 0.8,
      maxConcurrentTrades: 1,
      dailyLossLimitUsd: 50,
      profitTargetUsd: 200,
      maxAiSpendUsd: 5,
      maxDataSpendUsd: 5,
      humanApprovalRequired: false,
      updatedAt: "2026-05-05T00:00:00.000Z",
    },
    timeframe: {
      sessionId: "s1",
      timeframePresetId: "custom" as const,
      primaryTradingTimeframe: "1h",
      holdingStyle: "multi_day_swing",
      targetHoldDays: 3,
      maxHoldDays: 10,
      timeframeNotes: "",
      updatedAt: "2026-05-05T00:00:00.000Z",
    },
  };
}

describe("strategy-prompt-context", () => {
  it("truncates long timeframe notes inside the prompt snapshot", () => {
    const context = baseContext();
    context.timeframe.timeframeNotes = "x".repeat(600);

    const built = buildStrategyPromptContext(context);

    expect(built.snapshot.timeframe.timeframeNotes).toContain("...");
    expect(built.prompt).toContain("## Session trading horizon");
    expect(built.prompt).toContain("## Session research posture");
    expect(built.prompt).toContain("## Session trade rules");
    expect(built.prompt.length).toBeLessThan(2200);
  });

  it("prepends full strategy context before user content", () => {
    const out = prependStrategyContextToUserPrompt(baseContext(), "Instrument: AAPL");

    expect(out.prompt.startsWith("## Session research posture")).toBe(true);
    expect(out.prompt).toContain("trend_hunt");
    expect(out.prompt.endsWith("Instrument: AAPL")).toBe(true);
    expect(out.snapshot.rules.setupType).toBe("breakout");
  });

  it("includes authoritative role operating brief when a target role is set", () => {
    const context = baseContext();
    context.aiRoleProfiles = [
      {
        sessionId: "s1",
        role: "decision_maker",
        profileJson: {
          version: 1,
          objective: "Return a concise decision.",
          constraints: ["Prefer no_trade when evidence is weak."],
          toolPolicy: {},
          method: {
            checklist: ["Check confidence threshold before trading."],
            requiredEvidence: [],
            avoid: [],
          },
          output: {
            format: "structured_json",
            requiredSections: [],
            terminalAction: "Return only the runtime decision schema.",
          },
          custom_key: { pace: "deliberate" },
        },
        updatedAt: "2026-05-05T00:00:00.000Z",
      },
    ];

    const built = buildStrategyPromptContext(context, { role: "decision_maker" });

    expect(built.snapshot.version).toBe(5);
    expect(built.snapshot.aiRoleProfiles[0]?.profileJson.objective).toBe("Return a concise decision.");
    expect(built.prompt).toContain("## Role profile");
    expect(built.prompt).toContain("## Objective");
    expect(built.prompt).toContain("Return a concise decision.");
    expect(built.prompt).toContain("## Constraints");
    expect(built.prompt).toContain("## Additional profile JSON");
  });

  it("renders selector role-profile settings and discovery guidance for the instrument selector", () => {
    const context = baseContext();
    context.aiRoleProfiles = [
      {
        sessionId: "s1",
        role: "instrument_selector",
        profileJson: {
          version: 1,
          objective: "Discover and verify a high-quality shortlist.",
          constraints: ["Trending names are a seed list, not the shortlist."],
          toolPolicy: {},
          method: {
            checklist: ["Move from discovery to verification once novelty collapses."],
            requiredEvidence: ["timely_catalyst", "tradability"],
            avoid: ["Do not repeat the same symbol check unless it closes a specific unresolved gap."],
          },
          output: {
            format: "candidate_list",
            requiredSections: ["candidate rationale"],
            terminalAction: "submit_candidates",
          },
          selectorSettings: {
            maxDiscoverySteps: 8,
            forceSubmitAfterStep: 14,
          },
        },
        updatedAt: "2026-05-05T00:00:00.000Z",
      },
    ];

    const built = buildStrategyPromptContext(context, { role: "instrument_selector" });

    expect(built.prompt).toContain("## Role profile");
    expect(built.prompt).toContain("Trending names are a seed list, not the shortlist.");
    expect(built.prompt).toContain("candidate rationale");
    expect(built.prompt).toContain('"maxDiscoverySteps": 8');
    expect(built.prompt).toContain('"forceSubmitAfterStep": 14');
  });
});
