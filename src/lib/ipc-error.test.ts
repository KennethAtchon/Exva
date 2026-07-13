import { describe, expect, it } from "vitest";
import { formatIpcError } from "./ipc-error";

describe("formatIpcError", () => {
  it("prefers typed IPC code on Error", () => {
    const err = new Error("bad version");
    (err as Error & { code?: string }).code = "STALE_VERSION";
    expect(formatIpcError(err)).toEqual({
      code: "STALE_VERSION",
      message: "bad version",
      display: "[STALE_VERSION] bad version",
    });
  });

  it("avoids [object Object] for plain objects", () => {
    expect(formatIpcError({ code: "NOT_FOUND", message: "missing" })).toEqual({
      code: "NOT_FOUND",
      message: "missing",
      display: "[NOT_FOUND] missing",
    });
  });

  it("handles strings and unknowns", () => {
    expect(formatIpcError("boom").display).toBe("boom");
    expect(formatIpcError(null).display).toBe("Something went wrong");
  });
});
