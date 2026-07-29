import { ProviderHealthTracker } from "./provider-health-tracker";
import { AiBudgetGuard } from "./ai-budget-guard";

export {
  resolveWorkerRoutes,
  nextFallbackHop,
  type WorkerRouteHop,
  type WorkerRoute,
} from "./worker-route-resolver";

/** Process-wide provider circuit breaker (Solution 07). */
export const providerHealthTracker = new ProviderHealthTracker();

/** Process-wide AI budget guard (Solution 07). */
export const aiBudgetGuard = new AiBudgetGuard();

export function workspaceDayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}
