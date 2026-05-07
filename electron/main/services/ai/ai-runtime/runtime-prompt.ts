import type { AgentRole, StrategyType } from "@/lib/types";
import type { PromptAssetLoader } from "../prompt-asset-loader";

export function resolvePromptForRole(input: {
  role: AgentRole;
  promptSource: "default" | "session_override";
  promptMarkdown: string;
  strategyType?: StrategyType;
  promptLoader: PromptAssetLoader;
}): string {
  const { role, promptSource, promptMarkdown, strategyType, promptLoader } = input;
  if (promptSource === "session_override" && promptMarkdown.trim()) {
    return promptMarkdown.trim();
  }
  if (strategyType === "prediction_market") {
    if (role === "analyst_technical") return promptLoader.loadNamedAsset("analyst_statistical");
    if (role === "analyst_fundamental") return promptLoader.loadNamedAsset("analyst_contextual");
  }
  return promptLoader.load(role);
}

export function analysisLabelsForStrategy(strategyType: StrategyType): { first: string; second: string } {
  return strategyType === "prediction_market"
    ? { first: "Statistical analysis", second: "Contextual analysis" }
    : { first: "Technical analysis", second: "Fundamental analysis" };
}
