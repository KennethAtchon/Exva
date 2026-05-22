import type { SessionStrategyContext } from "@electron/shared/domain";
import type { SessionRepo } from "../../../../db/repositories/sessions/session-repo";
import type { WorkspacePreferencesRepo } from "../../../../db/repositories/workspace/workspace-prefs-repo";
import type { ApiCallLogRepo } from "../../../../db/repositories/system/api-call-log-repo";
import type { SearchRegistry } from "../../search";
import type { BrokerRoutingService } from "../../../broker/broker-routing-service";
import type { BrokerRegistry } from "../../../broker/broker-registry";
import type { ToolBuildContext } from "./tool-factory-registry";
import { resolveSearchProviderId } from "./resolve-search-provider";
import { resolveMockToolContext } from "./resolve-mock-tool-context";

export interface ToolContextBuilderDeps {
  sessionRepo: SessionRepo;
  workspacePrefsRepo: WorkspacePreferencesRepo;
  apiCallLogRepo: ApiCallLogRepo;
  searchRegistry: SearchRegistry;
  brokerRouting?: BrokerRoutingService;
  brokerRegistry?: BrokerRegistry;
}

export async function buildToolContext(
  deps: ToolContextBuilderDeps,
  input: {
    sessionId: string;
    cycleId?: string | null;
    tradeId?: string | null;
    strategyContext: SessionStrategyContext;
  },
): Promise<ToolBuildContext> {
  const searchProviderId = resolveSearchProviderId(
    deps.sessionRepo,
    deps.workspacePrefsRepo,
    input.sessionId,
  );
  const session = deps.sessionRepo.requireById(input.sessionId);
  const mock = await resolveMockToolContext({
    sessionId: input.sessionId,
    brokerRouting: deps.brokerRouting,
    brokerRegistry: deps.brokerRegistry,
  });

  return {
    sessionId: input.sessionId,
    cycleId: input.cycleId ?? null,
    tradeId: input.tradeId ?? null,
    searchProviderId,
    instrumentClasses: session.instrumentClasses,
    apiCallLogRepo: deps.apiCallLogRepo,
    searchRegistry: deps.searchRegistry,
    brokerRouting: deps.brokerRouting,
    brokerRegistry: deps.brokerRegistry,
    strategyContext: input.strategyContext,
    maxDataSpendUsd: input.strategyContext.riskConfig.maxDataSpendUsd,
    getMockOhlcv: mock.getMockOhlcv,
    mockNewsData: mock.mockNewsData,
    mockRedditData: mock.mockRedditData,
    mockTrendingData: mock.mockTrendingData,
    mockWebSearchData: mock.mockWebSearchData,
    mockUrlContent: mock.mockUrlContent,
    mockScenarioKind: mock.mockScenarioKind,
    isMockSession: mock.isMockSession,
  };
}
