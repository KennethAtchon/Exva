import { AsyncLocalStorage } from "node:async_hooks";
import type { ApiCallLogRepo } from "../../db/repositories/system/api-call-log-repo";

export interface ProviderCallScope {
  sessionId?: string | null;
  cycleId?: string | null;
  tradeId?: string | null;
}

const providerCallScopeStorage = new AsyncLocalStorage<ProviderCallScope>();

export function getProviderCallScope(): ProviderCallScope {
  return providerCallScopeStorage.getStore() ?? {};
}

export function runWithProviderCallScope<T>(
  scope: ProviderCallScope,
  fn: () => T,
): T {
  const parent = providerCallScopeStorage.getStore() ?? {};
  return providerCallScopeStorage.run({ ...parent, ...scope }, fn);
}

export async function runWithProviderCallScopeAsync<T>(
  scope: ProviderCallScope,
  fn: () => Promise<T>,
): Promise<T> {
  return runWithProviderCallScope(scope, fn);
}

export function logProviderCall(input: {
  apiCallLogRepo: ApiCallLogRepo;
  provider: string;
  callType: string;
  endpoint: string;
  latencyMs: number;
  status: "ok" | "error";
  fromCache?: boolean;
  costUsd?: number | null;
  creditsUsed?: number | null;
  scope?: ProviderCallScope;
}): void {
  const scope = { ...getProviderCallScope(), ...input.scope };
  input.apiCallLogRepo.insert({
    id: crypto.randomUUID(),
    session_id: scope.sessionId ?? null,
    trade_id: scope.tradeId ?? null,
    cycle_id: scope.cycleId ?? null,
    provider: input.provider,
    endpoint: input.endpoint,
    call_type: input.callType,
    credits_used: input.creditsUsed ?? null,
    cost_usd: input.costUsd ?? null,
    latency_ms: input.latencyMs,
    status: input.status,
    from_cache: input.fromCache ?? false,
    created_at: new Date().toISOString(),
  });
}
