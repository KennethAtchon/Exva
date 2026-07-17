import { describe, expect, it } from "vitest";
import { MockBrokerAdapter } from "../adapters/mock-adapter";
import {
  formatCertReport,
  runAdapterCertification,
} from "./adapter-certification";

describe("adapter certification (mock)", () => {
  it("passes the full surface against MockBrokerAdapter", async () => {
    const adapter = new MockBrokerAdapter({
      bias: "bullish",
      autoCloseAfterMs: 50,
    });
    const report = await runAdapterCertification({
      adapter,
      symbol: "AAPL",
      instrumentClass: "stock",
      trade: true,
      fillTimeoutMs: 5_000,
    });
    // eslint-disable-next-line no-console
    console.log(formatCertReport(report));
    expect(report.passed).toBe(true);
    expect(report.checks.some((c) => c.name === "testConnection" && c.ok)).toBe(
      true,
    );
    expect(
      report.checks.some((c) => c.name === "getAccountBalance" && c.ok),
    ).toBe(true);
    expect(
      report.checks.some(
        (c) => c.name === "taxonomyBROKER_AUTH" && c.ok,
      ),
    ).toBe(true);
    expect(
      report.checks.some(
        (c) => c.name === "taxonomyINSUFFICIENT_FUNDS" && c.ok,
      ),
    ).toBe(true);
    expect(
      report.checks.some(
        (c) => c.name === "taxonomyUNKNOWN_SYMBOL" && c.ok,
      ),
    ).toBe(true);
  });
});
