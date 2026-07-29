import { z } from "zod";
import { AppError } from "@electron/shared/infra/errors";
import type { AIWorkerOutputSchema } from "../core/types";

export interface WorkerOutputAttempt<T> {
  output: T;
  parseFallback: boolean;
  retried: boolean;
}

function zodIssuePaths(error: z.ZodError | null): string[] {
  if (!error) return [];
  return error.issues.map((issue) =>
    issue.path.length > 0 ? issue.path.join(".") : issue.code,
  );
}

/**
 * Strict parse → one repair (caller retries) → typed skip.
 * Never default required fields like `pHat` (Solution 02 WS6).
 */
export function parseWorkerOutput<T>(
  contract: AIWorkerOutputSchema<T>,
  structuredOutput: unknown | undefined,
  retried: boolean,
  recover?: (output: unknown) => unknown | undefined,
): WorkerOutputAttempt<T> | { needsRetry: true; retried: boolean } {
  let parsed =
    structuredOutput !== undefined
      ? contract.schema.safeParse(structuredOutput)
      : { success: false as const, error: null };

  if (!parsed.success && structuredOutput !== undefined && recover) {
    const recovered = recover(structuredOutput);
    if (recovered !== undefined) parsed = contract.schema.safeParse(recovered);
  }

  if (parsed.success) {
    return { output: parsed.data, parseFallback: false, retried };
  }

  if (!retried && contract.onValidationFailure === "retry_once") {
    return { needsRetry: true, retried: true };
  }

  if (contract.onValidationFailure === "fail_worker") {
    throw new AppError(
      `Model output invalid: ${zodIssuePaths(parsed.error).join(", ") || "schema mismatch"}`,
      "MODEL_OUTPUT_INVALID",
      {
        reasonCode: "model_output_invalid",
        fieldPaths: zodIssuePaths(parsed.error),
        retried,
      },
    );
  }

  if (
    contract.onValidationFailure === "substitute_empty" ||
    contract.onValidationFailure === "retry_once"
  ) {
    const empty = contract.schema.safeParse({});
    if (empty.success) {
      return {
        output: empty.data,
        parseFallback: true,
        retried,
      };
    }
    // Required fields (e.g. pHat) cannot be substituted — typed skip.
    throw new AppError(
      `Model output invalid after repair: ${zodIssuePaths(empty.error).join(", ") || zodIssuePaths(parsed.error).join(", ") || "schema mismatch"}`,
      "MODEL_OUTPUT_INVALID",
      {
        reasonCode: "model_output_invalid",
        fieldPaths:
          zodIssuePaths(empty.error).length > 0
            ? zodIssuePaths(empty.error)
            : zodIssuePaths(parsed.error),
        retried,
      },
    );
  }

  throw new AppError(
    `Structured output validation failed for worker output contract (${contract.onValidationFailure})`,
    "MODEL_OUTPUT_INVALID",
    {
      reasonCode: "model_output_invalid",
      fieldPaths: zodIssuePaths(parsed.error),
      retried,
    },
  );
}
