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
      "prediction_market",
    ]);
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
        "prediction_market",
      ],
    });
  });
});
