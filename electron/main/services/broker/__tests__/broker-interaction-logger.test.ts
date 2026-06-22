import { describe, expect, it } from "vitest";
import {
  formatPlaceOrderEndpoint,
  inferAlpacaHttpCallType,
} from "../broker-interaction-logger";

describe("broker-interaction-logger helpers", () => {
  it("formats placeOrder endpoints with side, symbol, type, and size", () => {
    expect(
      formatPlaceOrderEndpoint({
        side: "BUY",
        instrumentSymbol: "AAPL",
        instrumentType: "stock",
        sizeUsd: 250.5,
        clientOrderId: "abc-123",
      }),
    ).toBe("placeOrder/BUY/AAPL/stock/$250.50/abc-123");
  });

  it("classifies Alpaca HTTP calls for order lifecycle", () => {
    expect(inferAlpacaHttpCallType("POST", "/v2/orders")).toBe(
      "placeOrder_submit",
    );
    expect(inferAlpacaHttpCallType("DELETE", "/v2/orders/order-1")).toBe(
      "cancelOrder_submit",
    );
    expect(inferAlpacaHttpCallType("DELETE", "/v2/positions/AAPL")).toBe(
      "closePosition_submit",
    );
    expect(inferAlpacaHttpCallType("GET", "/v2/orders/order-1")).toBe(
      "order_status_poll",
    );
    expect(inferAlpacaHttpCallType("GET", "/v2/account")).toBe("broker_http");
  });
});
