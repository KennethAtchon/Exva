import { queryClient } from "@/lib/query-client";
import { useSessionStore } from "@/store/sessionStore";
import { useTradeStore } from "@/store/tradeStore";

/** React-query roots that embed environment-specific API results. */
const ENV_SCOPED_QUERY_ROOTS = new Set([
  "trades-session-options",
  "accounts-workspace",
  "cost-breakdown",
  "trade-detail",
  "trade-autopsies",
]);

export function clearWorkspaceEnvironmentCache(): void {
  useTradeStore.getState().setTrades([]);
  useTradeStore.getState().setSelected(null);
  useSessionStore.getState().setStats(null);
  useSessionStore.getState().setStatus("idle");

  void queryClient.removeQueries({
    predicate: (query) =>
      ENV_SCOPED_QUERY_ROOTS.has(String(query.queryKey[0] ?? "")),
  });
}
