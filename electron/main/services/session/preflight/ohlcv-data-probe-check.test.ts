import { describe, expect, it } from "vitest";
import { ohlcvDataProbeCheck } from "./ohlcv-data-probe-check";

describe("ohlcvDataProbeCheck", () => {
  it("always passes (no-op: OHLCV validation moved to V2 subscription layer)", async () => {
    const result = await ohlcvDataProbeCheck();
    expect(result).toEqual({ ok: true });
  });
});
