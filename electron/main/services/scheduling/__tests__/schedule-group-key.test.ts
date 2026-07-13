import { describe, expect, it } from "vitest";
import {
  computeScheduleGroupKey,
  type ScheduleGroupKeyInput,
} from "../schedule-group-key";
import type { CadenceSpec } from "@electron/shared/domain/experience-inputs/cadence";

const BASE: ScheduleGroupKeyInput = {
  templateId: "tmpl-1",
  templateVersion: 1,
  pipelineId: "pipe-a",
  strategyId: "mean-reversion",
  strategyImplementationVersion: 1,
  instrumentSetId: "set-x",
  instrumentSetRevision: 1,
  cadence: { kind: "interval", every: 15, unit: "minute", jitterPct: 0.05 },
  analysisTimeframe: "1h",
  marketCalendarId: "nyse-regular",
  strategyParameters: { zScoreEntry: -2 },
};

describe("computeScheduleGroupKey", () => {
  it("returns a 64-char hex string", () => {
    const key = computeScheduleGroupKey(BASE);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic — same input always yields the same key", () => {
    expect(computeScheduleGroupKey(BASE)).toBe(computeScheduleGroupKey(BASE));
  });

  it("differs when templateId changes", () => {
    const other = { ...BASE, templateId: "tmpl-2" };
    expect(computeScheduleGroupKey(BASE)).not.toBe(
      computeScheduleGroupKey(other),
    );
  });

  it("differs when templateVersion changes", () => {
    expect(computeScheduleGroupKey(BASE)).not.toBe(
      computeScheduleGroupKey({ ...BASE, templateVersion: 2 }),
    );
  });

  it("differs when pipelineId changes", () => {
    expect(computeScheduleGroupKey(BASE)).not.toBe(
      computeScheduleGroupKey({ ...BASE, pipelineId: "pipe-b" }),
    );
  });

  it("differs when strategyId changes", () => {
    expect(computeScheduleGroupKey(BASE)).not.toBe(
      computeScheduleGroupKey({ ...BASE, strategyId: "breakout" }),
    );
  });

  it("differs when strategyImplementationVersion changes", () => {
    expect(computeScheduleGroupKey(BASE)).not.toBe(
      computeScheduleGroupKey({ ...BASE, strategyImplementationVersion: 2 }),
    );
  });

  it("differs when instrumentSetId changes", () => {
    expect(computeScheduleGroupKey(BASE)).not.toBe(
      computeScheduleGroupKey({ ...BASE, instrumentSetId: "set-y" }),
    );
  });

  it("differs when instrumentSetRevision changes", () => {
    expect(computeScheduleGroupKey(BASE)).not.toBe(
      computeScheduleGroupKey({ ...BASE, instrumentSetRevision: 2 }),
    );
  });

  it("differs when analysisTimeframe changes", () => {
    expect(computeScheduleGroupKey(BASE)).not.toBe(
      computeScheduleGroupKey({ ...BASE, analysisTimeframe: "4h" }),
    );
  });

  it("differs when marketCalendarId changes", () => {
    expect(computeScheduleGroupKey(BASE)).not.toBe(
      computeScheduleGroupKey({ ...BASE, marketCalendarId: "always-open" }),
    );
  });

  it("differs when strategyParameters change", () => {
    expect(computeScheduleGroupKey(BASE)).not.toBe(
      computeScheduleGroupKey({
        ...BASE,
        strategyParameters: { zScoreEntry: -1 },
      }),
    );
  });

  it("is insensitive to strategyParameters key insertion order", () => {
    const a = computeScheduleGroupKey({
      ...BASE,
      strategyParameters: { a: 1, b: 2 },
    });
    const b = computeScheduleGroupKey({
      ...BASE,
      strategyParameters: { b: 2, a: 1 },
    });
    expect(a).toBe(b);
  });

  it("normalizes cadence units — 60min and 1h produce the same key", () => {
    const sixtyMin: CadenceSpec = {
      kind: "interval",
      every: 60,
      unit: "minute",
      jitterPct: 0.05,
    };
    const oneHour: CadenceSpec = {
      kind: "interval",
      every: 1,
      unit: "hour",
      jitterPct: 0.05,
    };
    const keyA = computeScheduleGroupKey({ ...BASE, cadence: sixtyMin });
    const keyB = computeScheduleGroupKey({ ...BASE, cadence: oneHour });
    expect(keyA).toBe(keyB);
  });

  it("differs for cadences that are NOT equivalent", () => {
    const fifteenMin: CadenceSpec = {
      kind: "interval",
      every: 15,
      unit: "minute",
      jitterPct: 0.05,
    };
    const thirtyMin: CadenceSpec = {
      kind: "interval",
      every: 30,
      unit: "minute",
      jitterPct: 0.05,
    };
    expect(computeScheduleGroupKey({ ...BASE, cadence: fifteenMin })).not.toBe(
      computeScheduleGroupKey({ ...BASE, cadence: thirtyMin }),
    );
  });
});
