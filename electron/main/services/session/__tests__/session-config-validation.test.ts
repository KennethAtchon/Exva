import { describe, expect, it } from "vitest";
import {
  hasBlockingConfigIssues,
  validateSessionConfiguration,
} from "../session-config-validation";

describe("validateSessionConfiguration", () => {
  it("blocks blocked experiences on non-sentinel sessions", () => {
    const issues = validateSessionConfiguration({
      experienceId: "options-flow-edge",
      supportState: "blocked",
      blockerMessage: "unreachable",
      acceptedInstrumentClasses: ["options"],
      selectedInstrumentClasses: ["options"],
      supportedTimeframes: ["1d"],
      selectedTimeframe: "1d",
      hasCertifiedPaperBroker: true,
      historyBarsActual: 100,
      historyBarsRequired: 50,
      duplicateScheduleGroup: false,
      isSentinelSession: false,
    });
    expect(hasBlockingConfigIssues(issues)).toBe(true);
    expect(issues.some((i) => i.code === "PRODUCER_UNREACHABLE")).toBe(true);
  });

  it("warns on insufficient history without blocking", () => {
    const issues = validateSessionConfiguration({
      experienceId: "rules-mean-reversion",
      supportState: "available",
      acceptedInstrumentClasses: ["stock"],
      selectedInstrumentClasses: ["stock"],
      supportedTimeframes: ["1h"],
      selectedTimeframe: "1h",
      hasCertifiedPaperBroker: true,
      historyBarsActual: 21,
      historyBarsRequired: 50,
      duplicateScheduleGroup: false,
      isSentinelSession: false,
    });
    expect(hasBlockingConfigIssues(issues)).toBe(false);
    expect(issues.some((i) => i.code === "HISTORY_INSUFFICIENT")).toBe(true);
  });

  it("blocks live_allowed for forward_paper_only experiences", () => {
    const issues = validateSessionConfiguration({
      experienceId: "options-flow-edge",
      supportState: "forward_paper_only",
      blockerMessage: "options proof pending",
      acceptedInstrumentClasses: ["options"],
      selectedInstrumentClasses: ["options"],
      supportedTimeframes: ["1d"],
      selectedTimeframe: "1d",
      hasCertifiedPaperBroker: true,
      historyBarsActual: 100,
      historyBarsRequired: 50,
      duplicateScheduleGroup: false,
      isSentinelSession: false,
      executionMode: "live_allowed",
    });
    expect(hasBlockingConfigIssues(issues)).toBe(true);
    expect(issues.some((i) => i.code === "FORWARD_PAPER_ONLY")).toBe(true);
  });

  it("blocks instrument set / strategy class mismatches", () => {
    const issues = validateSessionConfiguration({
      experienceId: "options-flow-edge",
      supportState: "forward_paper_only",
      acceptedInstrumentClasses: ["stock"],
      selectedInstrumentClasses: ["stock"],
      supportedTimeframes: ["1d"],
      selectedTimeframe: "1d",
      hasCertifiedPaperBroker: true,
      historyBarsActual: 100,
      historyBarsRequired: 50,
      duplicateScheduleGroup: false,
      isSentinelSession: true,
      instrumentSetId: "liquid-us-etfs",
      strategyId: "options-flow",
    });
    expect(hasBlockingConfigIssues(issues)).toBe(true);
    expect(issues.some((i) => i.code === "SET_STRATEGY_INCOMPATIBLE")).toBe(
      true,
    );
  });
});
