import { beforeEach, describe, expect, it, vi } from "vitest";

const { subscribe } = vi.hoisted(() => {
  const subscribe = vi.fn().mockImplementation(async () => () => {});
  vi.stubGlobal("window", {
    exva: {
      events: { subscribe },
    },
  });
  return { subscribe };
});

import { listenEvent } from "@/lib/exva";

describe("listenEvent", () => {
  beforeEach(() => {
    subscribe.mockClear();
    subscribe.mockImplementation(async () => () => {});
  });

  it("subscribes via window.exva.events.subscribe", async () => {
    const handler = vi.fn();
    await listenEvent("stats_update", handler);
    expect(subscribe).toHaveBeenCalledWith("stats_update", handler);
  });

  it("returns unsubscribe function from bridge", async () => {
    const unsubscribe = vi.fn();
    subscribe.mockResolvedValueOnce(unsubscribe);
    const handler = vi.fn();
    const off = await listenEvent("trade_opened", handler);
    expect(off).toBe(unsubscribe);
  });
});
