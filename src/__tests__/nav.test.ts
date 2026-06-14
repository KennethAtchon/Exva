import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NAV_ITEMS, type PageKey } from "@/lib/nav";

const APP_SWITCH_PAGES: PageKey[] = [
  "dashboard",
  "sessions",
  "brokers",
  "trades",
  "autopsy",
  "leaderboard",
  "strategy",
  "costs",
  "signals",
  "devpanel",
  "accounts",
];

describe("nav contract", () => {
  it("NAV_ITEMS ids cover every App.tsx switch case", () => {
    const navIds = new Set(NAV_ITEMS.map((item) => item.id));
    for (const page of APP_SWITCH_PAGES) {
      expect(navIds.has(page)).toBe(true);
    }
  });

  it("NAV_ITEMS ids are unique PageKey values", () => {
    const ids = NAV_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("App.tsx switch references only known PageKey nav ids", () => {
    const appSrc = readFileSync(path.resolve(__dirname, "../App.tsx"), "utf8");
    const caseMatches = [...appSrc.matchAll(/case\s+"(\w+)":/g)].map(
      (m) => m[1],
    );
    const navIds = new Set(NAV_ITEMS.map((item) => item.id));
    for (const page of caseMatches) {
      expect(navIds.has(page as PageKey)).toBe(true);
    }
  });
});
