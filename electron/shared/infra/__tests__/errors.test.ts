import { describe, expect, it } from "vitest";
import {
  AppError,
  serializeError,
  toIpcError,
  type AppErrorCode,
} from "../errors";

describe("AppError", () => {
  it("carries code and details", () => {
    const err = new AppError("Missing key", "MISSING_SECRET", {
      provider: "anthropic",
    });
    expect(err.code).toBe("MISSING_SECRET");
    expect(err.details).toEqual({ provider: "anthropic" });
    expect(err.name).toBe("AppError");
  });

  it("serializes AppError for IPC", () => {
    const serialized = serializeError(
      new AppError("Not found", "NOT_FOUND", { id: "s1" }),
    );
    expect(serialized).toEqual({
      code: "NOT_FOUND",
      message: "Not found",
      details: { id: "s1" },
    });
  });

  it("maps generic errors to UNKNOWN via toIpcError", () => {
    expect(toIpcError(new Error("boom"))).toEqual({
      code: "UNKNOWN",
      message: "boom",
    });
    expect(toIpcError("string error")).toEqual({
      code: "UNKNOWN",
      message: "Internal error",
    });
  });

  it("covers all documented error codes", () => {
    const codes: AppErrorCode[] = [
      "VALIDATION_FAILED",
      "MISSING_SECRET",
      "BROKER_UNREACHABLE",
      "NO_BROKER",
      "PREFLIGHT_FAILED",
    ];
    for (const code of codes) {
      expect(toIpcError(new AppError("test", code)).code).toBe(code);
    }
  });
});
