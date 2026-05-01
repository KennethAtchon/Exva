import type { AppServices } from "../services/app-services";
import { registerAccountHandlers } from "./accounts";
import { registerConfigHandlers } from "./config";
import { registerDashboardHandlers } from "./dashboard";
import { registerEventHandlers } from "./events";
import { registerSessionHandlers } from "./session";
import { registerStrategyHandlers } from "./strategy";
import { registerTemplateHandlers } from "./templates";
import { registerTradeHandlers } from "./trades";
import { registerWorkspaceHandlers } from "./workspace";

export function registerIpcHandlers(services: AppServices): void {
  registerDashboardHandlers(services);
  registerTradeHandlers(services);
  registerSessionHandlers(services);
  registerStrategyHandlers(services);
  registerWorkspaceHandlers(services);
  registerTemplateHandlers(services);
  registerConfigHandlers(services);
  registerAccountHandlers(services);
  registerEventHandlers(services);
}
