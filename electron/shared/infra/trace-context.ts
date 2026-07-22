const TRACE_ID_PATTERN = /^[0-9a-f]{32}$/;
const SPAN_ID_PATTERN = /^[0-9a-f]{16}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface TraceCarrier {
  traceparent: string;
  ipcInvocationId?: string;
  utilityRequestId?: string;
}

export interface ParsedTraceparent {
  traceId: string;
  parentSpanId: string;
  traceFlags: "00" | "01";
}

export interface IpcInvokeEnvelope<T = unknown> {
  __exvaIpc: 1;
  context: {
    traceparent: string;
    ipcInvocationId: string;
  };
  payload: T;
}

function randomHex(bytes: number): string {
  const values = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(values);
  return Array.from(values, (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

export function generateTraceId(): string {
  let value = randomHex(16);
  while (/^0+$/.test(value)) value = randomHex(16);
  return value;
}

export function generateSpanId(): string {
  let value = randomHex(8);
  while (/^0+$/.test(value)) value = randomHex(8);
  return value;
}

export function formatTraceparent(input: {
  traceId: string;
  spanId: string;
  traceFlags?: "00" | "01";
}): string {
  if (!isTraceId(input.traceId) || !isSpanId(input.spanId)) {
    throw new Error("Invalid trace context identifiers");
  }
  return `00-${input.traceId}-${input.spanId}-${input.traceFlags ?? "01"}`;
}

export function parseTraceparent(value: unknown): ParsedTraceparent | null {
  if (typeof value !== "string" || value.length !== 55) return null;
  const match = /^00-([0-9a-f]{32})-([0-9a-f]{16})-(00|01)$/.exec(value);
  if (!match || !isTraceId(match[1]) || !isSpanId(match[2])) return null;
  return {
    traceId: match[1],
    parentSpanId: match[2],
    traceFlags: match[3] as "00" | "01",
  };
}

export function createIpcInvokeEnvelope<T>(payload: T): IpcInvokeEnvelope<T> {
  const traceId = generateTraceId();
  const spanId = generateSpanId();
  return {
    __exvaIpc: 1,
    context: {
      traceparent: formatTraceparent({ traceId, spanId }),
      ipcInvocationId: globalThis.crypto.randomUUID(),
    },
    payload,
  };
}

export function parseIpcInvokeEnvelope(
  value: unknown,
): IpcInvokeEnvelope<unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    record.__exvaIpc !== 1 ||
    !record.context ||
    typeof record.context !== "object" ||
    Array.isArray(record.context)
  ) {
    return null;
  }
  if (
    !Object.keys(record).every((key) =>
      ["__exvaIpc", "context", "payload"].includes(key),
    )
  ) {
    return null;
  }
  const context = record.context as Record<string, unknown>;
  if (
    !Object.keys(context).every((key) =>
      ["traceparent", "ipcInvocationId"].includes(key),
    )
  ) {
    return null;
  }
  if (
    !parseTraceparent(context.traceparent) ||
    typeof context.ipcInvocationId !== "string" ||
    !UUID_PATTERN.test(context.ipcInvocationId)
  ) {
    return null;
  }
  return value as IpcInvokeEnvelope<unknown>;
}

export function isTraceCarrier(value: unknown): value is TraceCarrier {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (!parseTraceparent(record.traceparent)) return false;
  if (
    record.ipcInvocationId !== undefined &&
    (typeof record.ipcInvocationId !== "string" ||
      !UUID_PATTERN.test(record.ipcInvocationId))
  ) {
    return false;
  }
  if (
    record.utilityRequestId !== undefined &&
    (typeof record.utilityRequestId !== "string" ||
      !UUID_PATTERN.test(record.utilityRequestId))
  ) {
    return false;
  }
  return Object.keys(record).every((key) =>
    ["traceparent", "ipcInvocationId", "utilityRequestId"].includes(key),
  );
}

function isTraceId(value: string | undefined): value is string {
  return Boolean(value && TRACE_ID_PATTERN.test(value) && !/^0+$/.test(value));
}

function isSpanId(value: string | undefined): value is string {
  return Boolean(value && SPAN_ID_PATTERN.test(value) && !/^0+$/.test(value));
}
