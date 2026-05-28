import type { AppServices } from "../services/app-services";
import { registerAccountHandlers } from "./workspace/accounts";
import { registerApprovalHandlers } from "./trading/approvals";
import { registerBrokerAccountHandlers } from "./trading/broker-accounts";
import { registerConfigHandlers } from "./workspace/config";
import { registerDashboardHandlers } from "./system/dashboard";
import { registerDeveloperHandlers } from "./system/developer";
import { registerEventHandlers } from "./system/events";
import { registerReplayHandlers } from "./session/replay";
import { registerSessionHandlers } from "./session/session";
import { registerStrategyHandlers } from "./workspace/strategy";
import { registerTemplateHandlers } from "./session/templates";
import { registerTradeHandlers } from "./trading/trades";
import { registerAutopsyHandlers } from "./trading/autopsy";
import { registerPeriodAutopsyHandlers } from "./trading/period-autopsy";
import { registerWorkspaceHandlers } from "./workspace/workspace";

export function registerIpcHandlers(services: AppServices): void {
  registerDashboardHandlers(services);
  registerTradeHandlers(services);
  registerAutopsyHandlers(services);
  registerPeriodAutopsyHandlers(services);
  registerApprovalHandlers(services);
  registerSessionHandlers(services);
  registerStrategyHandlers(services);
  registerWorkspaceHandlers(services);
  registerTemplateHandlers(services);
  registerConfigHandlers(services);
  registerAccountHandlers(services);
  registerBrokerAccountHandlers(services);
  registerEventHandlers(services);
  registerReplayHandlers(services);
  registerDeveloperHandlers(services);
}
