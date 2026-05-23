import type { AIWorkerOutputSchema } from "../core/types";

export interface WorkerOutputAttempt<T> {
  output: T;
  parseFallback: boolean;
  retried: boolean;
}

export function parseWorkerOutput<T>(
  contract: AIWorkerOutputSchema<T>,
  structuredOutput: unknown | undefined,
  retried: boolean,
): WorkerOutputAttempt<T> | { needsRetry: true; retried: boolean } {
  const parsed =
    structuredOutput !== undefined
      ? contract.schema.safeParse(structuredOutput)
      : { success: false as const, error: null };

  if (parsed.success) {
    return { output: parsed.data, parseFallback: false, retried };
  }

  if (!retried && contract.onValidationFailure === "retry_once") {
    return { needsRetry: true, retried: true };
  }

  if (
    contract.onValidationFailure === "substitute_empty" ||
    contract.onValidationFailure === "retry_once"
  ) {
    return {
      output: contract.schema.parse({}),
      parseFallback: true,
      retried,
    };
  }

  throw new Error(
    `Structured output validation failed for worker output contract (${contract.onValidationFailure})`,
  );
}
