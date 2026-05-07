import type { AgentRole, InstrumentClass } from "@/lib/types";
import type { ToolSet } from "ai";
import type { SearchRegistry } from "../search";
import { createMarketTools } from "../tools/market-tools";
import type { BrokerRoutingService } from "../../broker/broker-routing-service";
import type { BrokerRegistry } from "../../broker/broker-registry";
import { ROLE_TOOL_POLICY } from "./ai-runtime-types";

export async function buildRoleTools(input: {
  sessionId: string;
  role: AgentRole;
  cycleId: string | null;
  resolveSearchTool: (sessionId: string, context?: { cycleId?: string | null; tradeId?: string | null }) => Promise<ToolSet[keyof ToolSet]>;
  searchRegistry: SearchRegistry;
  brokerRouting?: BrokerRoutingService;
  brokerRegistry?: BrokerRegistry;
  resolveSearchProviderId: (sessionId: string) => string | null;
}): Promise<ToolSet | undefined> {
  const policy = ROLE_TOOL_POLICY[input.role];
  if (policy.enforceNoTools) return undefined;

  const tools: ToolSet = {};
  const searchProviderId = input.resolveSearchProviderId(input.sessionId);
  if (policy.allowSearch && searchProviderId) {
    tools.search_web = await input.resolveSearchTool(input.sessionId, { cycleId: input.cycleId });
  }
  if (policy.allowMarketNewsTool) {
    const marketNewsTool = createMarketNewsTool({
      sessionId: input.sessionId,
      searchRegistry: input.searchRegistry,
      brokerRouting: input.brokerRouting,
      brokerRegistry: input.brokerRegistry,
      resolveSearchProviderId: input.resolveSearchProviderId,
    });
    if (marketNewsTool) tools.get_news = marketNewsTool;
  }

  return Object.keys(tools).length > 0 ? tools : undefined;
}

function createMarketNewsTool(input: {
  sessionId: string;
  searchRegistry: SearchRegistry;
  brokerRouting?: BrokerRoutingService;
  brokerRegistry?: BrokerRegistry;
  resolveSearchProviderId: (sessionId: string) => string | null;
}): ToolSet["get_news"] | undefined {
  if (!input.brokerRouting || !input.brokerRegistry) return undefined;
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
    searchRegistry: input.searchRegistry,
    searchProviderId: input.resolveSearchProviderId(input.sessionId),
  });
  return marketTools.get_news;
}
