import { create } from "zustand";
import type { SessionConfig } from "@/lib/types";

const DEFAULT: SessionConfig = {
  strategy: "passive_income",
  max_position_usd: 500,
  stop_loss_pct: 2.0,
  take_profit_pct: 4.0,
  max_concurrent_trades: 3,
  research_depth: "balanced",
  daily_loss_limit_usd: 200,
  profit_target_usd: 1000,
  max_api_spend_usd: 5.0,
  human_approval_required: false,
};

interface ConfigState {
  config: SessionConfig;
  setConfig: (c: SessionConfig) => void;
  patch: <K extends keyof SessionConfig>(
    key: K,
    value: SessionConfig[K],
  ) => void;
}

export const useConfigStore = create<ConfigState>((set) => ({
  config: DEFAULT,
  setConfig: (config) => set({ config }),
  patch: (key, value) =>
    set((s) => ({ config: { ...s.config, [key]: value } })),
}));
