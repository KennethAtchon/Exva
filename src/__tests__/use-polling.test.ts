// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePolling } from "@/hooks/usePolling";

function PollingProbe({
  fn,
  intervalMs,
  enabled,
}: {
  fn: () => void | Promise<void>;
  intervalMs: number;
  enabled: boolean;
}) {
  usePolling(fn, intervalMs, enabled);
  return null;
}

describe("usePolling", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  function renderProbe(
    fn: () => void | Promise<void>,
    intervalMs: number,
    enabled: boolean,
  ) {
    act(() => {
      root.render(createElement(PollingProbe, { fn, intervalMs, enabled }));
    });
  }

  it("fires callback immediately and on each interval", async () => {
    const fn = vi.fn();
    renderProbe(fn, 1000, true);

    expect(fn).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fn).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it("does not schedule polling when disabled", async () => {
    const fn = vi.fn();
    renderProbe(fn, 1000, false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it("clears interval on unmount", async () => {
    const fn = vi.fn();
    renderProbe(fn, 1000, true);
    expect(fn).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
