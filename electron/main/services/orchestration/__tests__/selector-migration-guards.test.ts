import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * Static guards that lock the selector-as-ordinary-phase migration so this
 * class of bug cannot regress (spec §8 invariants 4 & 6, §15 grep guards).
 *
 * Each guard greps the tracked tree. `git grep -l` exits non-zero when there
 * are no matches — which is the passing case — so we translate the exit code
 * into the list of offending files.
 *
 * This file itself names the forbidden symbols (as grep patterns), so it is
 * always excluded from its own results.
 */
const SELF = "selector-migration-guards.test.ts";

function filesMatching(pattern: string, pathspecs: string[]): string[] {
  try {
    const out = execFileSync(
      "git",
      ["grep", "-lE", pattern, "--", ...pathspecs],
      { encoding: "utf8" },
    );
    return out
      .split("\n")
      .filter(Boolean)
      .filter((file) => !file.endsWith(SELF));
  } catch (error) {
    // Exit status 1 with no stdout means "no matches" — the guard passed.
    const status = (error as { status?: number }).status;
    if (status === 1) return [];
    throw error;
  }
}

describe("selector migration guards", () => {
  it("no orchestration runtime code reads selectionMode (invariant 4)", () => {
    // Test fixtures legitimately build sessions with a selectionMode field; the
    // invariant is that no runtime code under orchestration/ reads it.
    const offenders = filesMatching("selectionMode", [
      "electron/main/services/orchestration/**/*.ts",
    ]).filter((file) => !file.includes("/__tests__/"));
    expect(offenders).toEqual([]);
  });

  it("the removed selector side-channel symbols are gone from the tree (invariant 6)", () => {
    const offenders = filesMatching(
      "selectorWorkerIds|resolveSelectorWorkerIds|resolvePipelineIdForSource",
      ["electron/**/*.ts", "src/**/*.ts"],
    );
    expect(offenders).toEqual([]);
  });

  it("the dead manual-ticker injection path is gone from the tree", () => {
    const offenders = filesMatching("injectManualTickers", [
      "electron/**/*.ts",
      "src/**/*.ts",
    ]);
    expect(offenders).toEqual([]);
  });
});
