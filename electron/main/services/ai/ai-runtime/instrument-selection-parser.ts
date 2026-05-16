import { AppError } from "@electron/shared/infra/errors";
import { instrumentSelectionSchema, type InstrumentSelection } from "@/lib/schemas";
import type { ZodIssue } from "zod";
import type { RunTrace } from "./ai-runtime-types";

export function parseInstrumentSelection(trace: RunTrace<undefined>): InstrumentSelection {
  let firstValidationError: string | null = null;

  // `submit_candidates` is terminal. Use the first valid call in chronological order.
  // This prevents later non-terminal calls from overriding an earlier "no candidates" submission.
  for (let i = 0; i < trace.steps.length; i++) {
    const step = trace.steps[i];
    if (!step) continue;
    for (const tc of step.toolCalls) {
      if (tc.tool !== "submit_candidates") continue;
      for (const [source, json] of [["args", tc.argsJson], ["result", tc.resultJson]] as const) {
        const parsed = tryParseSelectionJson(json);
        if (parsed.success) return parsed.data;
        if (!firstValidationError && parsed.error) {
          firstValidationError = `submit_candidates ${source} invalid: ${parsed.error}`;
        }
      }
    }
  }
  const fromText = tryParseSelectionJson(trace.assistantText);
  if (fromText.success) return fromText.data;
  if (!firstValidationError && fromText.error) {
    firstValidationError = `assistant JSON invalid: ${fromText.error}`;
  }

  if (firstValidationError) {
    throw new AppError(
      `Instrument selector payload validation failed: ${firstValidationError}`,
      "VALIDATION_FAILED",
    );
  }

  throw new AppError(
    "Instrument selector must call submit_candidates with a valid instrument list.",
    "VALIDATION_FAILED",
  );
}

function tryParseSelectionJson(json: string):
  | { success: true; data: InstrumentSelection }
  | { success: false; error: string | null } {
  try {
    const parsed = instrumentSelectionSchema.safeParse(JSON.parse(json));
    if (parsed.success) return { success: true, data: parsed.data };
    return { success: false, error: formatIssues(parsed.error.issues) };
  } catch {
    return { success: false, error: null };
  }
}

function formatIssues(issues: ZodIssue[]): string {
  return issues
    .map((issue) => `${issue.path.length ? issue.path.join(".") : "payload"}: ${issue.message}`)
    .join("; ");
}
