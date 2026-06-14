import { describe, expect, it, vi } from "vitest";
import { runWorkersConcurrently } from "../concurrent-group-runner";

describe("runWorkersConcurrently", () => {
  it("runs all tasks and preserves order", async () => {
    const order: number[] = [];
    const tasks = [0, 1, 2, 3].map(
      (index) => () =>
        new Promise<number>((resolve) => {
          order.push(index);
          resolve(index);
        }),
    );

    const results = await runWorkersConcurrently(tasks, 2);

    expect(results).toHaveLength(4);
    expect(results.every((entry) => entry.status === "fulfilled")).toBe(true);
    expect(
      results.map((entry) => (entry as PromiseFulfilledResult<number>).value),
    ).toEqual([0, 1, 2, 3]);
    expect(order).toEqual([0, 1, 2, 3]);
  });

  it("respects maxConcurrency by batching work", async () => {
    let active = 0;
    let peak = 0;
    const tasks = Array.from({ length: 6 }, () => async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return "ok";
    });

    await runWorkersConcurrently(tasks, 2);

    expect(peak).toBeLessThanOrEqual(2);
  });

  it("stops dispatching when shouldContinue returns false", async () => {
    const executed: number[] = [];
    const tasks = Array.from({ length: 5 }, (_, index) => async () => {
      executed.push(index);
      return index;
    });
    const shouldContinue = vi
      .fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    const results = await runWorkersConcurrently(tasks, 2, shouldContinue);

    expect(results).toHaveLength(2);
    expect(executed).toEqual([0, 1]);
  });

  it("captures rejected tasks without aborting siblings in the same batch", async () => {
    const tasks = [
      async () => "ok",
      async () => {
        throw new Error("boom");
      },
    ];

    const results = await runWorkersConcurrently(tasks, 2);

    expect(results[0]?.status).toBe("fulfilled");
    expect(results[1]?.status).toBe("rejected");
    if (results[1]?.status === "rejected") {
      expect(results[1].reason).toBeInstanceOf(Error);
    }
  });
});
