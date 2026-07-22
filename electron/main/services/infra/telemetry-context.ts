import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import {
  formatTraceparent,
  generateSpanId,
  generateTraceId,
  isTraceCarrier,
  parseTraceparent,
  type TraceCarrier,
} from "@electron/shared/infra/trace-context";

export interface OperationContext {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  ipcInvocationId: string | null;
  utilityRequestId: string | null;
}

let bootId: string = randomUUID();
const storage = new AsyncLocalStorage<OperationContext>();

export function getBootId(): string {
  return bootId;
}

export function configureTelemetryBootId(value: string): void {
  if (!/^[0-9a-f-]{36}$/i.test(value)) throw new Error("Invalid boot ID");
  bootId = value;
}

export function getTelemetryContext(): OperationContext | null {
  return storage.getStore() ?? null;
}

export function runWithRootSpan<T>(
  fields: Partial<
    Pick<OperationContext, "ipcInvocationId" | "utilityRequestId">
  >,
  fn: () => T,
): T {
  return storage.run(
    {
      traceId: generateTraceId(),
      spanId: generateSpanId(),
      parentSpanId: null,
      ipcInvocationId: fields.ipcInvocationId ?? null,
      utilityRequestId: fields.utilityRequestId ?? null,
    },
    fn,
  );
}

export function runWithChildSpan<T>(
  fields: Partial<
    Pick<OperationContext, "ipcInvocationId" | "utilityRequestId">
  >,
  fn: () => T,
): T {
  const parent = storage.getStore();
  if (!parent) return runWithRootSpan(fields, fn);
  return storage.run(
    {
      traceId: parent.traceId,
      spanId: generateSpanId(),
      parentSpanId: parent.spanId,
      ipcInvocationId: fields.ipcInvocationId ?? parent.ipcInvocationId,
      utilityRequestId: fields.utilityRequestId ?? parent.utilityRequestId,
    },
    fn,
  );
}

export function runWithRemoteParent<T>(carrier: TraceCarrier, fn: () => T): T {
  if (!isTraceCarrier(carrier)) throw new Error("Invalid trace carrier");
  const parent = parseTraceparent(carrier.traceparent)!;
  return storage.run(
    {
      traceId: parent.traceId,
      spanId: generateSpanId(),
      parentSpanId: parent.parentSpanId,
      ipcInvocationId: carrier.ipcInvocationId ?? null,
      utilityRequestId: carrier.utilityRequestId ?? null,
    },
    fn,
  );
}

export function runWithRemoteContext<T>(carrier: TraceCarrier, fn: () => T): T {
  if (!isTraceCarrier(carrier)) throw new Error("Invalid trace carrier");
  const remote = parseTraceparent(carrier.traceparent)!;
  return storage.run(
    {
      traceId: remote.traceId,
      spanId: remote.parentSpanId,
      parentSpanId: null,
      ipcInvocationId: carrier.ipcInvocationId ?? null,
      utilityRequestId: carrier.utilityRequestId ?? null,
    },
    fn,
  );
}

export function currentTraceCarrier(
  utilityRequestId?: string,
): TraceCarrier | null {
  const context = storage.getStore();
  if (!context) return null;
  return {
    traceparent: formatTraceparent({
      traceId: context.traceId,
      spanId: context.spanId,
    }),
    ...(context.ipcInvocationId
      ? { ipcInvocationId: context.ipcInvocationId }
      : {}),
    ...((utilityRequestId ?? context.utilityRequestId)
      ? { utilityRequestId: utilityRequestId ?? context.utilityRequestId! }
      : {}),
  };
}

export function telemetryLogFields(): Record<string, unknown> {
  const context = storage.getStore();
  return {
    bootId,
    traceId: context?.traceId ?? null,
    spanId: context?.spanId ?? null,
    parentSpanId: context?.parentSpanId ?? null,
    ipcInvocationId: context?.ipcInvocationId ?? null,
    utilityRequestId: context?.utilityRequestId ?? null,
  };
}
