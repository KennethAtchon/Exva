import { describe, expect, it } from "vitest";
import { normalizeQueryFamily, sanitizeSearchQuery, validateDiscoveryQuery } from "./sanitize-search-query";

describe("sanitizeSearchQuery", () => {
  it("strips filler and normalizes whitespace", () => {
    expect(sanitizeSearchQuery("  I'll search for:   NVDA breakout on volume   ")).toBe("NVDA breakout on volume");
  });
});

describe("validateDiscoveryQuery", () => {
  it("rejects empty queries after sanitization", () => {
    const result = validateDiscoveryQuery("let me search");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("empty");
  });

  it("rejects tool-name and digits-only meta queries", () => {
    expect(validateDiscoveryQuery("search_web")).toMatchObject({ ok: false });
    expect(validateDiscoveryQuery("645")).toMatchObject({ ok: false });
  });

  it("preserves useful queries and computes a normalized family", () => {
    const result = validateDiscoveryQuery("NVDA breakout on volume");
    expect(result).toMatchObject({ ok: true, sanitized: "NVDA breakout on volume" });
    expect(normalizeQueryFamily(result.sanitized)).toBe("nvda breakout on volume");
  });
});
