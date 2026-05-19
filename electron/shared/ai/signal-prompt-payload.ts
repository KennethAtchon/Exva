/**
 * Compact signal payloads for downstream LLM workers (audit-only fields stripped).
 */

export function signalForWorkerPrompt<T extends Record<string, unknown>>(
  signal: T,
): Omit<T, "rawSummary"> {
  const { rawSummary: _raw, ...rest } = signal;
  return rest as Omit<T, "rawSummary">;
}
