import { tool, type ToolSet } from "ai";
import type { AgentRole, InstrumentClass } from "@/lib/types";
import { instrumentSelectionSchema, type InstrumentSelection } from "@/lib/schemas";
import type { SearchRegistry } from "../search";
import { createMarketTools } from "../tools/market-tools";
import type { BrokerRoutingService } from "../../broker/broker-routing-service";
import type { BrokerRegistry } from "../../broker/broker-registry";
import type { RoleToolPolicy } from "./ai-runtime-types";
import { ROLE_TOOL_POLICY } from "./ai-runtime-types";

/** Tools actually registered for this run (policy ∩ infra). Drives prompts and ToolSet construction. */
export type HarnessToolAvailability = {
  searchWeb: boolean;
  getNews: boolean;
  getQuote: boolean;
  getOhlcv: boolean;
  submitCandidates: boolean;
};

export function deriveHarnessToolAvailability(
  policy: RoleToolPolicy,
  searchProviderId: string | null,
  hasBrokerWiring: boolean,
): HarnessToolAvailability {
  if (policy.enforceNoTools) {
    return {
      searchWeb: false,
      getNews: false,
      getQuote: false,
      getOhlcv: false,
      submitCandidates: false,
    };
  }
  const searchOk = Boolean(searchProviderId);
  const brokerOk = hasBrokerWiring;
  return {
    submitCandidates: policy.allowSubmitCandidates,
    searchWeb: policy.allowSearch && searchOk,
    getQuote: policy.allowMarketQuoteTools && brokerOk,
    getOhlcv: policy.allowMarketQuoteTools && brokerOk,
    getNews: policy.allowMarketNewsTool && brokerOk && searchOk,
  };
}

export function harnessToolAvailabilityForRole(
  role: AgentRole,
  searchProviderId: string | null,
  hasBrokerWiring: boolean,
): HarnessToolAvailability {
  return deriveHarnessToolAvailability(ROLE_TOOL_POLICY[role], searchProviderId, hasBrokerWiring);
}

export async function buildHarnessToolSet(input: {
  sessionId: string;
  role: AgentRole;
  cycleId: string | null;
  availability: HarnessToolAvailability;
  searchProviderId: string | null;
  resolveSearchTool: (sessionId: string, context?: { cycleId?: string | null; tradeId?: string | null }) => Promise<
    ToolSet[keyof ToolSet]
  >;
  searchRegistry: SearchRegistry;
  brokerRouting?: BrokerRoutingService;
  brokerRegistry?: BrokerRegistry;
}): Promise<ToolSet | undefined> {
  const { availability } = input;
  const tools: ToolSet = {};

  if (availability.submitCandidates) {
    tools.submit_candidates = tool({
      description: "Submit the final shortlist when research is complete.",
      inputSchema: instrumentSelectionSchema,
      execute: async (candidates: InstrumentSelection) => candidates,
    });
  }

  if (availability.searchWeb) {
    tools.search_web = await input.resolveSearchTool(input.sessionId, { cycleId: input.cycleId });
  }

  const needMarket =
    availability.getQuote || availability.getOhlcv || availability.getNews;
  if (needMarket) {
    if (!input.brokerRouting || !input.brokerRegistry) {
      return Object.keys(tools).length > 0 ? tools : undefined;
    }
    const marketTools = createMarketTools({
      sessionId: input.sessionId,
      brokerRegistry: input.brokerRegistry,
      brokerAccountIdByClass: (instrumentClass: InstrumentClass) => {
        try {
          return input.brokerRouting?.resolveBrokerAccountId(input.sessionId, instrumentClass) ?? null;
        } catch {
          return null;
        }
      },
      searchRegistry: availability.getNews ? input.searchRegistry : undefined,
      searchProviderId: availability.getNews ? input.searchProviderId : null,
      include: {
        quote: availability.getQuote,
        ohlcv: availability.getOhlcv,
        news: availability.getNews,
      },
    });
    if (marketTools.get_quote) tools.get_quote = marketTools.get_quote;
    if (marketTools.get_ohlcv) tools.get_ohlcv = marketTools.get_ohlcv;
    if (marketTools.get_news) tools.get_news = marketTools.get_news;
  }

  return Object.keys(tools).length > 0 ? tools : undefined;
}
