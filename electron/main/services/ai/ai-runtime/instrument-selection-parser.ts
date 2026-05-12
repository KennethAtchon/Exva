import { AppError } from "@electron/shared/errors";
import { instrumentSelectionSchema, type InstrumentSelection } from "@/lib/schemas";
import type { RunTrace } from "./ai-runtime-types";

export function parseInstrumentSelection(trace: RunTrace<undefined>): InstrumentSelection {
  // `submit_candidates` is terminal. Use the first valid call in chronological order.
  // This prevents later non-terminal calls from overriding an earlier "no candidates" submission.
  for (let i = 0; i < trace.steps.length; i++) {
    const step = trace.steps[i];
    if (!step) continue;
    for (const tc of step.toolCalls) {
      if (tc.tool !== "submit_candidates") continue;
      for (const json of [tc.resultJson, tc.argsJson]) {
        try {
          const parsed = instrumentSelectionSchema.safeParse(JSON.parse(json));
          if (parsed.success) return parsed.data;
        } catch {
          /* ignore malformed terminal tool payload */
        }
      }
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
