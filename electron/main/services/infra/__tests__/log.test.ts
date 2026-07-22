import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLogger,
  createRotatingFileStream,
  getRuntimeLogLevel,
  resetRuntimeLogLevel,
  setRuntimeLogLevel,
} from "../log";

describe("createLogger", () => {
  afterEach(() => {
    resetRuntimeLogLevel();
  });

  it("creates scoped loggers with standard levels", () => {
    const logger = createLogger("test-scope");
    expect(logger.info).toBeTypeOf("function");
    expect(logger.warn).toBeTypeOf("function");
    expect(logger.error).toBeTypeOf("function");
    expect(() => logger.info({ test: true }, "hello")).not.toThrow();
  });

  it("applies runtime levels to existing and future scoped loggers", () => {
    const existing = createLogger("runtime-level-existing");

    setRuntimeLogLevel("debug");
    const future = createLogger("runtime-level-future");

    expect(getRuntimeLogLevel()).toBe("debug");
    expect(existing.level).toBe("debug");
    expect(future.level).toBe("debug");
    expect(existing.isLevelEnabled("debug")).toBe(true);
    expect(existing.isLevelEnabled("trace")).toBe(false);

    setRuntimeLogLevel("error");

    expect(existing.level).toBe("error");
    expect(future.level).toBe("error");
    expect(existing.isLevelEnabled("warn")).toBe(false);
    expect(existing.isLevelEnabled("error")).toBe(true);
  });
});

describe("createRotatingFileStream", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "exva-log-test-"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("opens a new dated destination and closes the old one when the local date rolls over (regression: filename used to be fixed at process boot)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 23, 59, 0));

    const destinations: string[] = [];
    const endCalls: number[] = [];
    let endCount = 0;
    vi.spyOn(pino, "destination").mockImplementation((opts) => {
      const dest = (opts as { dest: string }).dest;
      destinations.push(dest);
      return {
        write: vi.fn(),
        end: () => {
          endCount += 1;
          endCalls.push(endCount);
        },
      } as unknown as ReturnType<typeof pino.destination>;
    });

    const stream = createRotatingFileStream(tmpDir);
    stream.write("line-1\n");
    expect(destinations).toEqual([path.join(tmpDir, "exva-2026-01-01.log")]);
    expect(endCount).toBe(0);

    vi.setSystemTime(new Date(2026, 0, 2, 0, 1, 0));
    stream.write("line-2\n");

    expect(destinations).toEqual([
      path.join(tmpDir, "exva-2026-01-01.log"),
      path.join(tmpDir, "exva-2026-01-02.log"),
    ]);
    expect(endCount).toBe(1);
    expect(endCalls).toEqual([1]);

    // Same day again: no new destination, no extra rotation.
    vi.setSystemTime(new Date(2026, 0, 2, 12, 0, 0));
    stream.write("line-3\n");
    expect(destinations).toHaveLength(2);
    expect(endCount).toBe(1);
  });
});
