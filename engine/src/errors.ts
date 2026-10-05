// Error classes the Runner maps to Decision reason codes. Anything else becomes strategy_error.

export class DataError extends Error {
  override name = "DataError";
}

/** The broker refused the request (4xx). Not retried. */
export class BrokerRejected extends Error {
  override name = "BrokerRejected";
}

/** The broker could not be reached or timed out. Safe to retry after looking up the order. */
export class BrokerUnavailable extends Error {
  override name = "BrokerUnavailable";
}

export class AiError extends Error {
  override name = "AiError";
}

/** Daily AI budget (or a bot's call limit) is used up. No money was spent. */
export class AiBudgetError extends Error {
  override name = "AiBudgetError";
}

/** Bad input from an API caller. Mapped to HTTP 400. */
export class InputError extends Error {
  override name = "InputError";
}
