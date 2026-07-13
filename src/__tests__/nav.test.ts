import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NAV_ITEMS, NAV_PRIMARY_IDS, type PageKey } from "@/lib/nav";

const APP_SWITCH_PAGES: PageKey[] = [
  "dashboard",
  "sessions",
  "signals",
  "research",
  "settings",
  "docs",
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

  it("primary rail is five hubs; docs is a secondary rail item", () => {
    expect(NAV_PRIMARY_IDS).toEqual([
      "dashboard",
      "sessions",
      "signals",
      "research",
      "settings",
    ]);
    expect(NAV_ITEMS.map((i) => i.id)).toEqual([...NAV_PRIMARY_IDS, "docs"]);
  });
});
