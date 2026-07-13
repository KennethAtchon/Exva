import { describe, expect, it } from "vitest";
import { ohlcvDataProbeCheck } from "./ohlcv-data-probe-check";

const session = { id: "session-1" } as const;

describe("ohlcvDataProbeCheck", () => {
  it("always passes (no-op: OHLCV validation moved to V2 subscription layer)", async () => {
    const result = await ohlcvDataProbeCheck(session as never, {} as never);
    expect(result).toEqual({ ok: true });
  });
});
