import type { AIPhaseContext } from "../../phases/types";

export type CachePolicyId = string;

export interface CacheWriteMeta {
  agentRunId: string;
  cycleId: string;
}

export interface CachePolicy<TOutput = unknown> {
  id: CachePolicyId;
  fingerprint(ctx: AIPhaseContext): string;
  read(ctx: AIPhaseContext, fingerprint: string): TOutput | null;
  write(
    ctx: AIPhaseContext,
    fingerprint: string,
    output: TOutput,
    meta: CacheWriteMeta,
  ): void;
}

const CACHE_POLICIES = new Map<CachePolicyId, CachePolicy>();

export function registerCachePolicy<TOutput>(
  policy: CachePolicy<TOutput>,
): void {
  CACHE_POLICIES.set(policy.id, policy as CachePolicy);
}

export function getCachePolicy(id: CachePolicyId): CachePolicy {
  const policy = CACHE_POLICIES.get(id);
  if (!policy) throw new Error(`Cache policy '${id}' is not registered`);
  return policy;
}
