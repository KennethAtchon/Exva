import type { InstrumentClass } from "@/lib/types";
import type { SignalSourceRecord } from "@electron/shared/domain";
import {
  MOCK_REHEARSAL_SIGNAL_SOURCE_ID,
  resolveMockRehearsalTicker,
} from "@electron/shared/instruments/mock-rehearsal";
import type { SignalSourcesRepo } from "../services/signals/repos/signal-sources-repo";
import { safeJsonParse } from "../services/infra/safe-json-parse";

export type MockRehearsalSignalConfig = {
  ticker: string;
  instrumentClass?: InstrumentClass;
  intervalMs?: number;
};

export function buildMockRehearsalConfigJson(
  config: MockRehearsalSignalConfig,
): string {
  return JSON.stringify({
    ticker: config.ticker,
    instrumentClass: config.instrumentClass ?? "stock",
    ...(config.intervalMs !== undefined
      ? { intervalMs: config.intervalMs }
      : {}),
  });
}

export function parseMockRehearsalConfigJson(
  configJson: string,
): MockRehearsalSignalConfig {
  const parsed = safeJsonParse<Partial<MockRehearsalSignalConfig>>(
    configJson,
    undefined,
    "mock-rehearsal.config",
  );
  if (!parsed) {
    return { ticker: resolveMockRehearsalTicker(), instrumentClass: "stock" };
  }
  return {
    ticker:
      typeof parsed.ticker === "string" && parsed.ticker.length > 0
        ? parsed.ticker
        : resolveMockRehearsalTicker(),
    instrumentClass:
      parsed.instrumentClass === "stock" ||
      parsed.instrumentClass === "crypto" ||
      parsed.instrumentClass === "futures" ||
      parsed.instrumentClass === "prediction_market"
        ? parsed.instrumentClass
        : "stock",
    ...(typeof parsed.intervalMs === "number"
      ? { intervalMs: parsed.intervalMs }
      : {}),
  };
}

export function ensureMockRehearsalSignalSource(
  sourcesRepo: SignalSourcesRepo,
  ticker: string = resolveMockRehearsalTicker(),
): SignalSourceRecord {
  const existing = sourcesRepo.get(MOCK_REHEARSAL_SIGNAL_SOURCE_ID);
  const configJson = buildMockRehearsalConfigJson({ ticker });

  if (existing) {
    if (existing.configJson !== configJson) {
      return sourcesRepo.update(MOCK_REHEARSAL_SIGNAL_SOURCE_ID, {
        configJson,
      });
    }
    return existing;
  }

  return sourcesRepo.create({
    id: MOCK_REHEARSAL_SIGNAL_SOURCE_ID,
    type: "mock",
    name: "Mock rehearsal",
    description:
      "Synthetic filing-style signals for mock broker rehearsal sessions.",
    enabled: true,
    configJson,
  });
}

export function syncMockRehearsalSignalSourceTicker(
  sourcesRepo: SignalSourcesRepo,
  ticker: string,
): SignalSourceRecord {
  return ensureMockRehearsalSignalSource(sourcesRepo, ticker);
}
