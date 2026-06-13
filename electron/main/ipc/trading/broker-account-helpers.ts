import type { InstrumentClass } from "@/lib/types";
import { AppError } from "@electron/shared/infra/errors";
import type { BrokerAccount } from "@/lib/types";
import type {
  MockExecutionTier,
  MockScenarioKind,
} from "@electron/shared/domain/mock-scenario";
import {
  DEFAULT_MOCK_EXECUTION_TIER,
  DEFAULT_MOCK_SCENARIO_KIND,
} from "@electron/shared/domain/mock-scenario";

export function supportedInstrumentClassesFor(
  brokerType: string,
): InstrumentClass[] {
  switch (brokerType) {
    case "alpaca":
      return ["stock"];
    case "coinbase_advanced_trade":
      return ["crypto"];
    case "tradovate":
      return ["futures"];
    case "polymarket":
      return ["prediction_market"];
    case "mock":
      return ["stock", "crypto", "futures", "prediction_market"];
    default:
      throw new AppError(
        `Unknown broker type: ${brokerType}`,
        "UNKNOWN_BROKER",
      );
  }
}

export function serializeBrokerCredentials(
  brokerType: string,
  mode: "paper" | "live",
  creds: Record<string, string>,
): string {
  switch (brokerType) {
    case "alpaca":
      return JSON.stringify({
        provider: "alpaca" as const,
        api_key: creds.api_key ?? creds.apiKey ?? "",
        secret_key: creds.secret_key ?? creds.secretKey ?? "",
        mode,
      });
    case "coinbase_advanced_trade":
      return JSON.stringify({
        apiKey: creds.apiKey ?? creds.api_key ?? "",
        apiSecret: creds.apiSecret ?? creds.api_secret ?? "",
        passphrase: creds.passphrase ?? "",
      });
    case "tradovate":
      return JSON.stringify({
        username: creds.username ?? "",
        password: creds.password ?? "",
        cid: creds.cid,
        secret: creds.secret,
      });
    case "mock":
      return "{}";
    case "polymarket":
      return JSON.stringify({
        privateKey: creds.privateKey ?? creds.private_key ?? "",
        funderAddress: creds.funderAddress ?? creds.funder_address ?? "",
        host: creds.host ?? "https://clob.polymarket.com",
        chainId: Number(creds.chainId ?? creds.chain_id ?? 137),
      });
    default:
      throw new AppError(
        `Unknown broker type: ${brokerType}`,
        "UNKNOWN_BROKER",
      );
  }
}

export function tempBrokerAccount(
  id: string,
  input: {
    name: string;
    brokerType: string;
    mode: "paper" | "live";
    mockScenarioKind?: MockScenarioKind | null;
    mockExecutionTier?: MockExecutionTier | null;
  },
): BrokerAccount {
  return {
    id,
    name: input.name,
    brokerType: input.brokerType,
    supportedInstrumentClasses: supportedInstrumentClassesFor(input.brokerType),
    mode: input.mode,
    mockScenarioKind:
      input.brokerType === "mock"
        ? (input.mockScenarioKind ?? DEFAULT_MOCK_SCENARIO_KIND)
        : null,
    mockExecutionTier:
      input.brokerType === "mock"
        ? (input.mockExecutionTier ?? DEFAULT_MOCK_EXECUTION_TIER)
        : null,
    maxSessions: 10,
    allocationEnforcement: "hard",
    balanceRefreshIntervalMin: 5,
    balanceCacheUsd: null,
    balanceCachedAt: null,
    secretRef: `broker:${id}`,
    updatedAt: new Date().toISOString(),
  };
}
