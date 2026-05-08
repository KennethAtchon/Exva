import { tradeDecisionSchema } from "@/lib/schemas";
import type { z } from "zod";

type TradeDecision = z.infer<typeof tradeDecisionSchema>;

export function tryParseDecisionFromText(text: string): TradeDecision | null {
  let candidate: unknown;
  try {
    candidate = JSON.parse(text.trim());
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      candidate = JSON.parse(match[0]);
    } catch {
      return null;
    }
  }

  const parsed = tradeDecisionSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
