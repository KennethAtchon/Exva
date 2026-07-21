import { describe, expect, it } from "vitest";
import {
  classifyPollError,
  isSignalSourceRuntimeHealthy,
} from "../signal-source-health";

describe("isSignalSourceRuntimeHealthy", () => {
  const now = Date.parse("2026-07-20T18:00:00.000Z");

  it("returns false when durable state is missing", () => {
    expect(isSignalSourceRuntimeHealthy(null, now)).toBe(false);
  });

  it("returns true for a recent successful poll", () => {
    expect(
      isSignalSourceRuntimeHealthy(
        {
          status: "running",
          lastSuccessAt: "2026-07-20T17:50:00.000Z",
          consecutiveFailures: 0,
        },
        now,
      ),
    ).toBe(true);
  });

  it("returns false for error status even with a recent success", () => {
    expect(
      isSignalSourceRuntimeHealthy(
        {
          status: "error",
          lastSuccessAt: "2026-07-20T17:50:00.000Z",
          consecutiveFailures: 1,
        },
        now,
      ),
    ).toBe(false);
  });

  it("returns false when the last success is stale", () => {
    expect(
      isSignalSourceRuntimeHealthy(
        {
          status: "running",
          lastSuccessAt: "2026-07-20T16:00:00.000Z",
          consecutiveFailures: 0,
        },
        now,
      ),
    ).toBe(false);
  });
});

describe("classifyPollError", () => {
  it("classifies http and parse failures", () => {
    expect(classifyPollError("Gamma markets status 503")).toBe("http_error");
    expect(classifyPollError("Gamma markets parse error (status 200)")).toBe(
      "parse_error",
    );
    expect(classifyPollError("socket hang up")).toBe("error");
  });
});
