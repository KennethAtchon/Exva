import type { AppServices } from "../services/app-services";
import { registerAccountHandlers } from "./accounts";
import { registerApprovalHandlers } from "./approvals";
import { registerBrokerAccountHandlers } from "./broker-accounts";
import { registerConfigHandlers } from "./config";
import { registerDashboardHandlers } from "./dashboard";
import { registerDeveloperHandlers } from "./developer";
import { registerEventHandlers } from "./events";
import { registerReplayHandlers } from "./replay";
import { registerSessionHandlers } from "./session";
import { registerStrategyHandlers } from "./strategy";
import { registerTemplateHandlers } from "./templates";
import { registerTradeHandlers } from "./trades";
import { registerWorkspaceHandlers } from "./workspace";

export function registerIpcHandlers(services: AppServices): void {
  registerDashboardHandlers(services);
  registerTradeHandlers(services);
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
