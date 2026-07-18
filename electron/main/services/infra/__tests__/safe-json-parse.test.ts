import { describe, expect, it } from "vitest";
import { z } from "zod";
import { requireJsonParse, safeJsonParse } from "../safe-json-parse";

describe("safeJsonParse", () => {
  it("returns parsed value for valid JSON", () => {
    expect(safeJsonParse('{"a":1}')).toEqual({ a: 1 });
  });

  it("returns null for malformed JSON", () => {
    expect(safeJsonParse("{")).toBeNull();
  });

  it("returns null when schema validation fails", () => {
    const schema = z.object({ a: z.number() });
    expect(safeJsonParse('{"a":"x"}', schema)).toBeNull();
  });

  it("returns typed value when schema matches", () => {
    const schema = z.object({ a: z.number() });
    expect(safeJsonParse('{"a":2}', schema)).toEqual({ a: 2 });
  });

  it("returns null for malformed JSON even with context", () => {
    expect(safeJsonParse("{", undefined, "test-context")).toBeNull();
  });
});

describe("requireJsonParse", () => {
  it("returns parsed value for valid JSON", () => {
    expect(requireJsonParse('{"a":1}')).toEqual({ a: 1 });
  });

  it("throws for malformed JSON", () => {
    expect(() => requireJsonParse("{", undefined, "bad")).toThrow("bad");
  });
});
