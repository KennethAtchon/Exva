import { tool } from "ai";
import { z } from "zod";
import type { SearchRegistry } from "../search";
import { validateDiscoveryQuery } from "../search/sanitize-search-query";
import type { ApiCallLogRepo } from "../../db/repositories/system/api-call-log-repo";
import { assertSessionDataSpendAvailable } from "./data-spend-guard";
import {
  filterMockWebSearch,
  type MockWebSearchItem,
} from "../broker/mock/mock-discovery-fixtures";

export function createMockSearchTool(deps: {
  sessionId: string;
  apiCallLogRepo: ApiCallLogRepo;
  cycleId?: string | null;
  tradeId?: string | null;
  mockWebSearchData: MockWebSearchItem[];
  mockPrimarySymbols?: string[];
}) {
  return tool({
    description: [
      "Search the web for current financial news, market signals, catalysts, and trading ideas.",
      "Use specific queries with tickers, company names, sectors, catalysts, or setup terms such as breakout, momentum, unusual options activity, short interest, insider buying, social sentiment, or earnings surprise.",
      "After finding a promising result, use fetch_url to read the actual content before trusting it.",
    ].join(" "),
    inputSchema: z.object({ query: z.string().min(1) }),
    execute: async (input: { query: string }) => {
      const startedAt = Date.now();
      const createdAt = new Date().toISOString();
      const results = filterMockWebSearch(
        deps.mockWebSearchData,
        input.query,
        8,
        deps.mockPrimarySymbols,
      );
      deps.apiCallLogRepo.insert({
        id: crypto.randomUUID(),
        session_id: deps.sessionId,
        trade_id: deps.tradeId ?? null,
        cycle_id: deps.cycleId ?? null,
        provider: "mock",
        endpoint: "/search",
        call_type: "search",
        credits_used: 0,
        cost_usd: null,
        latency_ms: Date.now() - startedAt,
        status: "ok",
        from_cache: true,
        created_at: createdAt,
      });
      return {
        results,
        query: input.query,
        provider: "mock",
        creditsUsed: 0,
        cachedAt: createdAt,
      };
    },
  });
}

export async function createSearchTool(deps: {
  sessionId: string;
  searchProviderId: string;
  fallbackProviderId?: string | null;
  searchRegistry: SearchRegistry;
  apiCallLogRepo: ApiCallLogRepo;
  cycleId?: string | null;
  tradeId?: string | null;
  maxDataSpendUsd?: number | null;
}) {
  const adapter = await deps.searchRegistry.get(deps.searchProviderId);
  const fallbackAdapter =
    deps.fallbackProviderId && deps.fallbackProviderId !== deps.searchProviderId
      ? await deps.searchRegistry.get(deps.fallbackProviderId)
      : null;
  return tool({
    description: [
      "Search the web for current financial news, market signals, catalysts, and trading ideas.",
      "Use specific queries with tickers, company names, sectors, catalysts, or setup terms such as breakout, momentum, unusual options activity, short interest, insider buying, social sentiment, or earnings surprise.",
      "Favor high-signal sources like Reddit threads, niche screeners, unusual activity sites, and timely market coverage.",
      "Avoid generic SEO listicles and broad 'top stocks' queries.",
      "After finding a promising result, use fetch_url to read the actual content before trusting it.",
    ].join(" "),
    inputSchema: z.object({ query: z.string().min(1) }),
    execute: async (input: { query: string }) => {
      const startedAt = Date.now();
      const createdAt = new Date().toISOString();
      assertSessionDataSpendAvailable({
        sessionId: deps.sessionId,
        apiCallLogRepo: deps.apiCallLogRepo,
        maxDataSpendUsd: deps.maxDataSpendUsd,
      });
      const validation = validateDiscoveryQuery(input.query);
      if (!validation.ok) {
        return { error: `Search blocked by query guard: ${validation.reason}` };
      }
      try {
        const out = await adapter.search(validation.sanitized);
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
        if (fallbackAdapter) {
          try {
            const out = await fallbackAdapter.search(validation.sanitized);
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
          } catch (fallbackError) {
            error = fallbackError;
          }
        }
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
