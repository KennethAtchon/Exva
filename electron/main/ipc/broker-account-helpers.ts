import type { InstrumentClass } from "@/lib/types";
import { AppError } from "@electron/shared/errors";
import type { BrokerAccount } from "@/lib/types";

export function supportedInstrumentClassesFor(brokerType: string): InstrumentClass[] {
  switch (brokerType) {
    case "alpaca":
      return ["stock"];
    case "coinbase_advanced_trade":
      return ["crypto"];
    case "tradovate":
      return ["futures"];
    case "mock":
      return ["stock", "crypto", "futures"];
    default:
      throw new AppError(`Unknown broker type: ${brokerType}`, "UNKNOWN_BROKER");
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
    default:
      throw new AppError(`Unknown broker type: ${brokerType}`, "UNKNOWN_BROKER");
  }
}

export function tempBrokerAccount(
  id: string,
  input: { name: string; brokerType: string; mode: "paper" | "live" },
): BrokerAccount {
  return {
    id,
    name: input.name,
    brokerType: input.brokerType,
    supportedInstrumentClasses: supportedInstrumentClassesFor(input.brokerType),
    mode: input.mode,
    secretRef: `broker:${id}`,
    updatedAt: new Date().toISOString(),
  };
}
