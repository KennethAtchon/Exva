import { AppError } from "@electron/shared/errors";
import { instrumentSelectionSchema, type InstrumentSelection } from "@/lib/schemas";
import type { RunTrace } from "./ai-runtime-types";

export function parseInstrumentSelection(trace: RunTrace<undefined>): InstrumentSelection {
  for (let i = trace.steps.length - 1; i >= 0; i--) {
    const step = trace.steps[i];
    if (!step) continue;
    for (const tc of step.toolCalls) {
      if (tc.tool !== "submit_candidates") continue;
      const parsed = instrumentSelectionSchema.safeParse(JSON.parse(tc.resultJson));
      if (parsed.success) return parsed.data;
    }
  }
  try {
    const fromText = instrumentSelectionSchema.safeParse(JSON.parse(trace.assistantText));
    if (fromText.success) return fromText.data;
  } catch {
    /* ignore malformed assistant JSON */
  }
  throw new AppError(
    "Instrument selector must call submit_candidates with a valid instrument list.",
    "VALIDATION_FAILED",
  );
}
