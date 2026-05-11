import type { AgentRole, ResearchDiscoveryMode } from "@/lib/types";
import type { PromptAssetLoader } from "../prompt-asset-loader";

export function resolvePromptForRole(input: {
  role: AgentRole;
  promptSource: "default" | "session_override";
  promptMarkdown: string;
  discoveryMode?: ResearchDiscoveryMode;
  promptLoader: PromptAssetLoader;
}): string {
  const { role, promptSource, promptMarkdown, discoveryMode, promptLoader } = input;
  if (promptSource === "session_override" && promptMarkdown.trim()) {
    return promptMarkdown.trim();
  }
  if (discoveryMode === "event_contract_scan") {
    if (role === "analyst_technical") return promptLoader.loadNamedAsset("analyst_statistical");
    if (role === "analyst_fundamental") return promptLoader.loadNamedAsset("analyst_contextual");
  }
  return promptLoader.load(role);
}

export function analysisLabelsForStrategy(discoveryMode?: ResearchDiscoveryMode): { first: string; second: string } {
  return discoveryMode === "event_contract_scan"
    ? { first: "Statistical analysis", second: "Contextual analysis" }
    : { first: "Technical analysis", second: "Fundamental analysis" };
}
