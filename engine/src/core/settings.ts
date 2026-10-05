import type { SettingsPatch } from "@shared/schemas.ts";
import type { AiProvider, Settings } from "@shared/types.ts";
import type { SecretsFile } from "../config.ts";
import type { Store } from "../store/store.ts";

/** Base URL and model per provider. DeepSeek V4.1 Flash is served as "deepseek-flash". */
export const AI_PRESETS: Record<AiProvider, { baseUrl: string; model: string }> = {
  deepseek: { baseUrl: "https://api.deepseek.com", model: "deepseek-flash" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", model: "deepseek/deepseek-v4-flash" },
  custom: { baseUrl: "https://api.deepseek.com", model: "deepseek-flash" },
};

type Stored = Omit<Settings, "ai"> & { ai: Omit<Settings["ai"], "hasKey"> };

// DeepSeek peak-hour rates, so the budget errs on the safe side (off-peak is half).
export const DEFAULT_SETTINGS: Stored = {
  onboarded: false,
  killSwitch: false,
  ai: {
    provider: "deepseek",
    ...AI_PRESETS.deepseek,
    inputPricePerM: 0.3,
    cachedInputPricePerM: 0.006,
    outputPricePerM: 1.2,
    dailyBudgetUsd: 2,
    journalHour: 8,
  },
  data: { stockFeed: "iex" },
  defaults: { dollarsPerTrade: 1_000, dailyLossLimitUsd: 200 },
  app: { launchAtLogin: false, keepRunningInTray: true, preventSleep: true, notifications: true },
};

export class SettingsService {
  constructor(
    private readonly store: Store,
    private readonly secrets: SecretsFile,
  ) {}

  private stored(): Stored {
    const s = this.store.getJson<Partial<Stored>>("settings") ?? {};
    return {
      ...DEFAULT_SETTINGS,
      ...s,
      ai: { ...DEFAULT_SETTINGS.ai, ...s.ai },
      data: { ...DEFAULT_SETTINGS.data, ...s.data },
      defaults: { ...DEFAULT_SETTINGS.defaults, ...s.defaults },
      app: { ...DEFAULT_SETTINGS.app, ...s.app },
    };
  }

  get(): Settings {
    const s = this.stored();
    return { ...s, ai: { ...s.ai, hasKey: Boolean(this.aiKey()) } };
  }

  patch(p: SettingsPatch): Settings {
    const cur = this.stored();
    const ai = { ...cur.ai, ...p.ai };
    if (p.ai?.provider && p.ai.provider !== cur.ai.provider && p.ai.provider !== "custom") {
      Object.assign(ai, AI_PRESETS[p.ai.provider], {
        baseUrl: p.ai.baseUrl ?? AI_PRESETS[p.ai.provider].baseUrl,
      });
      if (p.ai.model) ai.model = p.ai.model;
    }
    const next: Stored = {
      ...cur,
      onboarded: p.onboarded ?? cur.onboarded,
      ai,
      data: { ...cur.data, ...p.data },
      defaults: { ...cur.defaults, ...p.defaults },
      app: { ...cur.app, ...p.app },
    };
    this.store.setJson("settings", next);
    if (p.aiApiKey !== undefined) {
      this.secrets.update((s) => {
        s.aiApiKey = p.aiApiKey || null;
      });
    }
    return this.get();
  }

  setKillSwitch(on: boolean): void {
    this.store.setJson("settings", { ...this.stored(), killSwitch: on });
  }

  aiKey(): string | null {
    return this.secrets.read().aiApiKey;
  }
}
