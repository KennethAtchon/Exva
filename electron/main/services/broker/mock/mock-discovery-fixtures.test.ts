import { describe, expect, it } from "vitest";
import {
  MOCK_SCENARIO_KINDS,
  type MockScenarioKind,
} from "@electron/shared/domain/mock-scenario";
import { MockMarketSimulator } from "./mock-market-simulator";
import {
  SCENARIO_NEWS,
  SCENARIO_REDDIT,
  SCENARIO_TRENDING,
} from "./mock-scenario-fixtures";
import {
  extractQuerySymbol,
  filterMockWebSearch,
  resolveMockSymbolForUrl,
  SCENARIO_PRIMARY_SYMBOLS,
  SCENARIO_URL_CONTENT,
  SCENARIO_WEB_SEARCH,
  substituteMockSymbol,
} from "./mock-discovery-fixtures";

describe("mock discovery fixtures", () => {
  it("returns bullish NVDA search results without live providers", () => {
    const results = filterMockWebSearch(
      SCENARIO_WEB_SEARCH.clean_breakout,
      "NVDA breakout momentum continuation",
      8,
      SCENARIO_PRIMARY_SYMBOLS.clean_breakout,
    );

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.title).toContain("NVDA");
    expect(results[0]?.url).toContain("mock.local");
    expect(results.every((row) => !row.title.includes("{symbol}"))).toBe(true);
  });

  it("surfaces a synthetic EDGAR 8-K catalyst for the happy path", () => {
    // Catalyst / document-first postures require a material SEC filing; without
    // one the decision phase skips even on a clean breakout. The clean_breakout
    // scenario must therefore carry an 8-K so the happy path can open a trade.
    const results = filterMockWebSearch(
      SCENARIO_WEB_SEARCH.clean_breakout,
      "NVDA 8-K filing material agreement catalyst",
      8,
      SCENARIO_PRIMARY_SYMBOLS.clean_breakout,
    );
    const eightK = results.find((row) => row.title.includes("8-K"));
    expect(eightK).toBeDefined();
    expect(eightK?.title).toContain("NVDA");

    const url = eightK?.url ?? "";
    const body = SCENARIO_URL_CONTENT.clean_breakout[url];
    expect(body).toBeDefined();
    expect(body).toMatch(/Item 1\.01|Material Definitive Agreement/);
  });

  it("prefers known primary symbols over noisy uppercase tokens", () => {
    expect(
      extractQuerySymbol("I want NVDA momentum data", ["NVDA", "AMD", "PLTR"]),
    ).toBe("NVDA");
    expect(
      extractQuerySymbol("US tech sector NVDA", ["NVDA", "AMD", "PLTR"]),
    ).toBe("NVDA");
  });

  it("falls back to knownSymbols for generic queries without ticker tokens", () => {
    const known = SCENARIO_PRIMARY_SYMBOLS.clean_breakout;
    const results = filterMockWebSearch(
      SCENARIO_WEB_SEARCH.clean_breakout,
      "strong breakout stocks today momentum continuation",
      8,
      known,
    );

    expect(
      extractQuerySymbol("strong breakout stocks today momentum", known),
    ).toBeNull();
    expect(results[0]?.title).toContain("NVDA");
    expect(results.every((row) => !row.title.includes("TODAY"))).toBe(true);
  });

  it("matches explicit ticker in specific queries", () => {
    expect(
      extractQuerySymbol("NVDA stock breakout catalyst May 2026", [
        "NVDA",
        "AMD",
        "PLTR",
      ]),
    ).toBe("NVDA");
  });

  it("substitutes fetch_url page bodies using primary symbol fallback", () => {
    const url = "https://mock.local/search/clean_breakout/1";
    const raw = SCENARIO_URL_CONTENT.clean_breakout[url];
    expect(raw).toBeDefined();
    if (!raw) {
      throw new Error(`Missing mock URL content for ${url}`);
    }
    const symbol = resolveMockSymbolForUrl(
      url,
      SCENARIO_PRIMARY_SYMBOLS.clean_breakout,
    );
    const content = substituteMockSymbol(raw, symbol);

    expect(content).toContain("NVDA");
    expect(content).not.toContain("{symbol}");
  });

  it("clean_breakout fixtures stay directionally coherent", () => {
    const fixtures = MockMarketSimulator.fixturesFor("clean_breakout");
    const primary = fixtures.primarySymbols[0] ?? "NVDA";
    const text = [
      ...fixtures.webSearch.map(
        (row) =>
          `${substituteMockSymbol(row.title, primary)} ${substituteMockSymbol(row.snippet, primary)}`,
      ),
      ...Object.values(fixtures.urlContent).map((body) =>
        substituteMockSymbol(body, primary),
      ),
      ...fixtures.news.map(
        (row) =>
          `${substituteMockSymbol(row.title, primary)} ${substituteMockSymbol(row.snippet, primary)}`,
      ),
    ]
      .join(" ")
      .toLowerCase();

    expect(text).toMatch(/breakout|momentum|resistance|strength/);
    expect(text).not.toContain("{symbol}");
    expect(text).toContain(primary.toLowerCase());
  });

  it("covers every mock scenario kind in the discovery catalog", () => {
    const urlOptionalKinds = new Set<MockScenarioKind>([
      "stale_quote",
      "wide_spread",
    ]);

    for (const kind of MOCK_SCENARIO_KINDS) {
      expect(SCENARIO_PRIMARY_SYMBOLS[kind].length).toBeGreaterThan(0);
      expect(SCENARIO_WEB_SEARCH[kind].length).toBeGreaterThan(0);
      if (!urlOptionalKinds.has(kind)) {
        expect(Object.keys(SCENARIO_URL_CONTENT[kind]).length).toBeGreaterThan(
          0,
        );
      }
      expect(SCENARIO_NEWS[kind].length).toBeGreaterThan(0);
      expect(SCENARIO_REDDIT[kind].length).toBeGreaterThan(0);
      expect(SCENARIO_TRENDING[kind].length).toBeGreaterThan(0);

      const fixtures = MockMarketSimulator.fixturesFor(kind);
      expect(fixtures.primarySymbols).toEqual(SCENARIO_PRIMARY_SYMBOLS[kind]);
      expect(fixtures.webSearch).toEqual(SCENARIO_WEB_SEARCH[kind]);
    }
  });
});
