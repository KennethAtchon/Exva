import { tool } from "ai";
import { z } from "zod";
import type { SearchRegistry } from "../search";
import { sanitizeSearchQuery } from "../search/sanitize-search-query";
import type { ApiCallLogRepo } from "../../../db/repositories/api-call-log-repo";

export async function createSearchTool(deps: {
  sessionId: string;
  searchProviderId: string;
  searchRegistry: SearchRegistry;
  apiCallLogRepo: ApiCallLogRepo;
  cycleId?: string | null;
  tradeId?: string | null;
  maxDataSpendUsd?: number | null;
}) {
  const adapter = await deps.searchRegistry.get(deps.searchProviderId);
  return tool({
    description: "Search the web for current information.",
    inputSchema: z.object({ query: z.string().min(1) }),
    execute: async (input: { query: string }) => {
      const startedAt = Date.now();
      const createdAt = new Date().toISOString();
      if (deps.maxDataSpendUsd != null && deps.apiCallLogRepo.dailyDataSpendUsd(deps.sessionId) >= deps.maxDataSpendUsd) {
        return { error: "Session max data spend reached; search blocked by runtime policy." };
      }
      try {
        const out = await adapter.search(sanitizeSearchQuery(input.query));
        deps.apiCallLogRepo.insert({
          id: crypto.randomUUID(),
          session_id: deps.sessionId,
          trade_id: deps.tradeId ?? null,
          cycle_id: deps.cycleId ?? null,
          provider: out.provider,
          endpoint: "/search",
          call_type: "search",
          credits_used: out.creditsUsed,
          cost_usd: null,
          latency_ms: Date.now() - startedAt,
          status: "ok",
          from_cache: out.cachedAt != null,
          created_at: createdAt,
        });
        return out;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        deps.apiCallLogRepo.insert({
          id: crypto.randomUUID(),
          session_id: deps.sessionId,
          trade_id: deps.tradeId ?? null,
          cycle_id: deps.cycleId ?? null,
          provider: adapter.providerType,
          endpoint: "/search",
          call_type: "search",
          credits_used: null,
          cost_usd: null,
          latency_ms: Date.now() - startedAt,
          status: /\b429\b/.test(message) ? "rate_limited" : "error",
          from_cache: false,
          created_at: createdAt,
        });
        throw error;
      }
    },
  });
}
