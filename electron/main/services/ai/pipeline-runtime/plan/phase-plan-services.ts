import type { AgentMessagesRepo } from "../../../../db/repositories/agents/agent-messages-repo";
import type { AgentRunsRepo } from "../../../../db/repositories/agents/agent-runs-repo";
import type { InstrumentCacheRepo } from "../../../../db/repositories/market/instrument-cache-repo";
import type { SessionAiPhasesRepo } from "../../../../db/repositories/sessions/session-ai-phases-repo";
import type { SessionBrokerAssignmentsRepo } from "../../../../db/repositories/sessions/session-broker-assignments-repo";
import type { SessionSelectorSettingsRepo } from "../../../../db/repositories/sessions/session-selector-settings-repo";
import type { WorkspacePreferencesRepo } from "../../../../db/repositories/workspace/workspace-prefs-repo";
import type { BrokerAccountsRepo } from "../../../../db/repositories/brokers/broker-accounts-repo";
import type { BrokerRoutingService } from "../../../broker/broker-routing-service";
import type { SessionStrategyContextService } from "../../../session/session-strategy-context-service";

export interface PhasePlanServices {
  sessionSelectorSettingsRepo: SessionSelectorSettingsRepo;
  sessionAiPhasesRepo: SessionAiPhasesRepo;
  workspacePreferencesRepo: WorkspacePreferencesRepo;
  instrumentCacheRepo: InstrumentCacheRepo;
  agentRunsRepo: AgentRunsRepo;
  agentMessagesRepo: AgentMessagesRepo;
  sessionBrokerAssignmentsRepo: SessionBrokerAssignmentsRepo;
  brokerAccountsRepo: BrokerAccountsRepo;
  brokerRouting: BrokerRoutingService;
  strategyContextService: SessionStrategyContextService;
}
