import { describe, expect, it } from "vitest";
import {
  serializeBrokerCredentials,
  supportedInstrumentClassesFor,
  tempBrokerAccount,
} from "../trading/broker-account-helpers";

describe("broker-account-helpers", () => {
  it("maps broker types to the instrument classes they support", () => {
    expect(supportedInstrumentClassesFor("alpaca")).toEqual([
      "stock",
      "crypto",
      "options",
    ]);
    expect(supportedInstrumentClassesFor("coinbase_advanced_trade")).toEqual([
      "crypto",
    ]);
    expect(supportedInstrumentClassesFor("tradovate")).toEqual(["futures"]);
    expect(supportedInstrumentClassesFor("polymarket")).toEqual([
      "prediction_market",
    ]);
    expect(supportedInstrumentClassesFor("mock")).toEqual([
      "stock",
      "crypto",
      "futures",
      "options",
      "prediction_market",
    ]);
    expect(supportedInstrumentClassesFor("kalshi")).toEqual([
      "prediction_market",
    ]);
    expect(supportedInstrumentClassesFor("tradier")).toEqual([
      "stock",
      "options",
    ]);
    expect(supportedInstrumentClassesFor("kraken")).toEqual(["crypto"]);
  });

  it("serializes kalshi/tradier/kraken credentials", () => {
    expect(
      JSON.parse(
        serializeBrokerCredentials("kalshi", "paper", {
          keyId: "kid",
          privateKeyPem: "PEM",
        }),
      ),
    ).toEqual({ keyId: "kid", privateKeyPem: "PEM" });
    expect(
      JSON.parse(
        serializeBrokerCredentials("tradier", "paper", {
          accessToken: "tok",
          accountId: "VA123",
        }),
      ),
    ).toEqual({ accessToken: "tok", accountId: "VA123" });
    expect(
      JSON.parse(
        serializeBrokerCredentials("kraken", "paper", {
          apiKey: "k",
          apiSecret: "s",
        }),
      ),
    ).toEqual({ apiKey: "k", apiSecret: "s" });
  });

  it("preserves paper/live mode when serializing Alpaca credentials", () => {
    expect(
      JSON.parse(
        serializeBrokerCredentials("alpaca", "paper", {
          apiKey: "paper-key",
          secretKey: "paper-secret",
        }),
      ),
    ).toEqual({
      provider: "alpaca",
      api_key: "paper-key",
      secret_key: "paper-secret",
      mode: "paper",
    });

    expect(
      JSON.parse(
        serializeBrokerCredentials("alpaca", "live", {
          api_key: "live-key",
          secret_key: "live-secret",
        }),
      ),
    ).toEqual({
      provider: "alpaca",
      api_key: "live-key",
      secret_key: "live-secret",
      mode: "live",
    });
  });

  it("builds temporary broker accounts with the requested mode", () => {
    expect(
      tempBrokerAccount("paper-mock", {
        name: "Paper Mock",
        brokerType: "mock",
        mode: "paper",
      }),
    ).toMatchObject({
      id: "paper-mock",
      brokerType: "mock",
      mode: "paper",
      supportedInstrumentClasses: [
        "stock",
        "crypto",
        "futures",
        "options",
        "prediction_market",
      ],
    });

    expect(
      tempBrokerAccount("live-mock", {
        name: "Live Mock",
        brokerType: "mock",
        mode: "live",
      }),
    ).toMatchObject({
      id: "live-mock",
      brokerType: "mock",
      mode: "live",
      supportedInstrumentClasses: [
        "stock",
        "crypto",
        "futures",
        "options",
        "prediction_market",
      ],
    });
  });
});
