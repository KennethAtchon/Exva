import { AppError, type AppErrorCode } from "@electron/shared/infra/errors";

export type BrokerErrorCode = Extract<
  AppErrorCode,
  | "BROKER_AUTH"
  | "BROKER_INSUFFICIENT_FUNDS"
  | "BROKER_UNKNOWN_SYMBOL"
  | "BROKER_REJECTED"
  | "BROKER_ERROR"
  | "BROKER_RATE_LIMIT"
  | "BROKER_DATA"
>;

/**
 * Map common broker HTTP/API failures into typed AppErrors so adapters never
 * leak raw HTTP bodies to callers / cert suite expectations.
 */
export function brokerError(
  code: BrokerErrorCode,
  message: string,
  details?: Record<string, unknown>,
): AppError {
  return new AppError(message, code, details);
}

/** Malformed or missing money-relevant fields from a broker API response. */
export function brokerDataError(
  message: string,
  details?: Record<string, unknown>,
): AppError {
  return brokerError("BROKER_DATA", message, details);
}

/**
 * Parse a broker numeric field. Absent/null/NaN/non-finite → BROKER_DATA.
 * Explicit `0` is allowed (e.g. zero cash balance).
 */
export function requireFiniteNumber(
  value: unknown,
  field: string,
  details?: Record<string, unknown>,
): number {
  if (value === undefined || value === null || value === "") {
    throw brokerDataError(`Missing broker field: ${field}`, {
      field,
      ...details,
    });
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw brokerDataError(`Invalid broker field: ${field}`, {
      field,
      value,
      ...details,
    });
  }
  return n;
}

/** Price (or fill avg) that must be strictly positive. */
export function requirePositivePrice(
  value: unknown,
  field: string,
  details?: Record<string, unknown>,
): number {
  const n = requireFiniteNumber(value, field, details);
  if (!(n > 0)) {
    throw brokerDataError(`Non-positive broker price: ${field}`, {
      field,
      value: n,
      ...details,
    });
  }
  return n;
}

export function classifyHttpBrokerError(input: {
  status: number;
  body: string;
  broker: string;
}): AppError {
  const snippet = input.body.slice(0, 200);
  const lower = input.body.toLowerCase();
  if (input.status === 401 || input.status === 403) {
    return brokerError(
      "BROKER_AUTH",
      `${input.broker} auth failed (${input.status}): ${snippet}`,
      { status: input.status },
    );
  }
  if (input.status === 429) {
    return brokerError(
      "BROKER_RATE_LIMIT",
      `${input.broker} rate limited: ${snippet}`,
      { status: input.status },
    );
  }
  if (
    lower.includes("insufficient") ||
    lower.includes("buying power") ||
    lower.includes("not enough") ||
    lower.includes("balance")
  ) {
    return brokerError(
      "BROKER_INSUFFICIENT_FUNDS",
      `${input.broker} insufficient funds: ${snippet}`,
      { status: input.status },
    );
  }
  if (
    lower.includes("unknown symbol") ||
    lower.includes("invalid symbol") ||
    lower.includes("not found") ||
    lower.includes("does not exist") ||
    lower.includes("unknown asset")
  ) {
    return brokerError(
      "BROKER_UNKNOWN_SYMBOL",
      `${input.broker} unknown symbol: ${snippet}`,
      { status: input.status },
    );
  }
  return brokerError(
    "BROKER_ERROR",
    `${input.broker} request failed (${input.status}): ${snippet}`,
    { status: input.status },
  );
}
