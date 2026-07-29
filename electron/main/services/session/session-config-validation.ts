/**
 * Configuration-time session validation (Solution 09 WS2).
 * Blocks unreachable / incompatible combinations before create.
 */

import type { ExperienceSupportState } from "../../experiences/types";

export type ConfigValidationSeverity = "block" | "warn";

export interface ConfigValidationIssue {
  code: string;
  severity: ConfigValidationSeverity;
  message: string;
}

export interface SessionConfigValidationInput {
  experienceId: string;
  supportState: ExperienceSupportState;
  blockerMessage?: string | null;
  acceptedInstrumentClasses: readonly string[];
  selectedInstrumentClasses: readonly string[];
  supportedTimeframes: readonly string[];
  selectedTimeframe: string | null;
  hasCertifiedPaperBroker: boolean;
  historyBarsActual: number | null;
  historyBarsRequired: number | null;
  duplicateScheduleGroup: boolean;
  isSentinelSession: boolean;
}

export function validateSessionConfiguration(
  input: SessionConfigValidationInput,
): ConfigValidationIssue[] {
  const issues: ConfigValidationIssue[] = [];

  if (input.supportState === "blocked" && !input.isSentinelSession) {
    issues.push({
      code: "PRODUCER_UNREACHABLE",
      severity: "block",
      message:
        input.blockerMessage ??
        `Experience ${input.experienceId} is blocked and sentinel-only.`,
    });
  }

  for (const cls of input.selectedInstrumentClasses) {
    if (
      input.acceptedInstrumentClasses.length > 0 &&
      !input.acceptedInstrumentClasses.includes(cls)
    ) {
      issues.push({
        code: "CLASS_INCOMPATIBLE",
        severity: "block",
        message: `Instrument class ${cls} is not accepted by ${input.experienceId}.`,
      });
    }
  }

  if (
    input.selectedTimeframe &&
    input.supportedTimeframes.length > 0 &&
    !input.supportedTimeframes.includes(input.selectedTimeframe)
  ) {
    issues.push({
      code: "TIMEFRAME_INCOMPATIBLE",
      severity: "block",
      message: `Timeframe ${input.selectedTimeframe} is not supported.`,
    });
  }

  if (!input.hasCertifiedPaperBroker) {
    issues.push({
      code: "BROKER_ROUTE_MISSING",
      severity: "block",
      message: "No certified paper broker account for the selected classes.",
    });
  }

  if (
    input.historyBarsActual != null &&
    input.historyBarsRequired != null &&
    input.historyBarsActual < input.historyBarsRequired
  ) {
    issues.push({
      code: "HISTORY_INSUFFICIENT",
      severity: "warn",
      message: `Stored bars ${input.historyBarsActual} < required ${input.historyBarsRequired}. Provision history before the first scan.`,
    });
  }

  if (input.duplicateScheduleGroup) {
    issues.push({
      code: "SCHEDULE_DUPLICATE",
      severity: "warn",
      message:
        "Another session shares this schedule group — not an independent stress lane.",
    });
  }

  return issues;
}

export function hasBlockingConfigIssues(
  issues: readonly ConfigValidationIssue[],
): boolean {
  return issues.some((i) => i.severity === "block");
}
