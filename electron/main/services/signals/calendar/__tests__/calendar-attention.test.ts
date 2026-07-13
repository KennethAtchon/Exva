/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, expect, it } from "vitest";
import { buildCalendarAttentionQueue } from "../calendar-attention";

describe("calendar attention queue", () => {
  it("notes holdings into binary events", () => {
    const items = buildCalendarAttentionQueue({
      nowMs: Date.parse("2026-07-13T12:00:00.000Z"),
      events: [
        {
          eventType: "earnings",
          scheduledAt: "2026-07-15T20:00:00.000Z",
          symbol: "NVDA",
          title: "NVDA earnings",
        },
      ],
      holdings: [
        {
          sessionId: "s1",
          sessionName: "breakout session",
          symbol: "NVDA",
          quantity: 40,
        },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.message).toContain("holds 40 shares");
    expect(items[0]!.severity).toBe("warn");
  });
});
