import type { SessionStrategy } from "@electron/shared/domain";
import { buildStrategyTimeframeContext as buildStrategyTimeframeLines } from "@electron/shared/domain";

/** Keeps AI user prompts bounded when notes are very long (Phase 7). */
const MAX_NOTES_CHARS = 500;

/**
 * Same facts as `buildStrategyTimeframeContext` in shared domain, with long
 * `timeframeNotes` truncated for token budget.
 */
export function buildStrategyTimeframeContext(strategy: SessionStrategy): string {
  const trimmed = strategy.timeframeNotes.trim();
  const timeframeNotes =
    trimmed.length > MAX_NOTES_CHARS ? `${trimmed.slice(0, MAX_NOTES_CHARS)}…` : strategy.timeframeNotes;
  return buildStrategyTimeframeLines({ ...strategy, timeframeNotes });
}

export function prependStrategyHorizonToUserPrompt(strategy: SessionStrategy, userPrompt: string): string {
  return `${buildStrategyTimeframeContext(strategy)}\n\n${userPrompt}`;
}
