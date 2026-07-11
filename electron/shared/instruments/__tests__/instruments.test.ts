import { describe, expect, it } from "vitest";
import {
  EDGAR_DEFAULT_WHITELIST,
  EDGAR_EXPERIMENTAL_ITEM_CODES,
  EDGAR_RESEARCH_ITEM_CODES,
} from "../edgar-item-codes";
import {
  checkEdgarTradability,
  DEFAULT_EDGAR_TRADABILITY,
} from "../edgar-tradability";
import {
  classifyFilingPolarity,
  polarityToDirection,
} from "../filing-polarity";
import {
  FUTURE_FILING_SIGNAL_KINDS,
  groupFutureSignalsByKind,
  isFutureFilingSignalEligible,
} from "../filing-signal-stubs";
import { computePostFilingReaction } from "../post-filing-reaction";
import {
  isUsMarketHoliday,
  nyseHolidayKey,
  US_MARKET_HOLIDAYS,
} from "../us-market-holidays";
import {
  buildSearchEverythingScope,
  isSearchEverythingEnabled,
  isSearchEverythingScope,
  parseSearchEverythingFocusInstrumentClass,
  resolveBrokerInstrumentClasses,
  resolveEffectiveInstrumentClasses,
} from "../session-instrument-classes";
import {
  brokerOverlapsExperience,
  experienceBrokerOverlap,
  isSessionLaunchable,
  resolveSessionInstrumentClasses,
} from "../experience-launchability";
import {
  BUILT_IN_DUCKDUCKGO_PROVIDER_ID,
  buildBuiltInDuckDuckGoProviderAccount,
  getSearchProviderDisplayName,
  isBuiltInSearchProviderAccount,
} from "../search-providers";

describe("edgar-item-codes", () => {
  it("defines research whitelist and experimental codes", () => {
    expect(EDGAR_RESEARCH_ITEM_CODES).toContain("2.02");
    expect(EDGAR_DEFAULT_WHITELIST).toEqual(["1.01", "2.02", "8.01"]);
    expect(EDGAR_EXPERIMENTAL_ITEM_CODES).toContain("1.03");
    expect(
      EDGAR_DEFAULT_WHITELIST.every((code) =>
        EDGAR_RESEARCH_ITEM_CODES.includes(code),
      ),
    ).toBe(true);
  });
});

describe("edgar-tradability", () => {
  it("passes liquid large-cap names", () => {
    expect(
      checkEdgarTradability({
        priceUsd: 50,
        volumeShares: 20_000,
        spreadPct: 0.1,
        marketCapBucket: "large",
      }),
    ).toEqual({ ok: true });
  });

  it("rejects penny stocks and wide spreads", () => {
    expect(
      checkEdgarTradability({
        priceUsd: 2,
        volumeShares: 100_000,
        spreadPct: 0.1,
      }).ok,
    ).toBe(false);
    expect(
      checkEdgarTradability({
        priceUsd: 20,
        volumeShares: 100,
        spreadPct: 2,
      }).ok,
    ).toBe(false);
  });

  it("uses default filters", () => {
    expect(DEFAULT_EDGAR_TRADABILITY.minPriceUsd).toBe(5);
  });
});

describe("filing-polarity", () => {
  it("classifies item codes and headline keywords", () => {
    expect(classifyFilingPolarity({ itemCodes: ["1.03"] })).toBe("negative");
    expect(classifyFilingPolarity({ itemCodes: ["2.02"] })).toBe("positive");
    expect(
      classifyFilingPolarity({
        itemCodes: ["8.01"],
        headline: "Company announces bankruptcy investigation",
      }),
    ).toBe("negative");
  });

  it("maps polarity to trade direction", () => {
    expect(polarityToDirection("positive")).toBe("long");
    expect(polarityToDirection("negative")).toBe("short");
    expect(polarityToDirection("unknown")).toBeNull();
  });
});

describe("filing-signal-stubs", () => {
  it("groups eligible future signals by kind", () => {
    const grouped = groupFutureSignalsByKind([
      {
        kind: "form_4_insider",
        accessionNumber: "0001",
        ticker: "AAPL",
        filedAt: new Date().toISOString(),
      },
      {
        kind: "analyst_cluster",
        accessionNumber: "0002",
        ticker: "",
        filedAt: new Date().toISOString(),
      },
    ]);
    expect(grouped.form_4_insider).toHaveLength(1);
    expect(grouped.analyst_cluster).toHaveLength(0);
    expect(FUTURE_FILING_SIGNAL_KINDS).toHaveLength(7);
    expect(
      isFutureFilingSignalEligible({
        kind: "analyst_cluster",
        accessionNumber: "0003",
        ticker: "MSFT",
        filedAt: new Date().toISOString(),
        metadata: { deterministicSource: true },
      }),
    ).toBe(true);
  });
});

describe("post-filing-reaction", () => {
  it("computes gap and reaction from bars", () => {
    const filedAt = "2026-06-13T14:30:00.000Z";
    const reaction = computePostFilingReaction({
      filedAt,
      latencyMinutes: 0,
      bars: [
        {
          date: "2026-06-13T14:00:00.000Z",
          open: 100,
          high: 101,
          low: 99,
          close: 100,
          volume: 1000,
        },
        {
          date: "2026-06-13T14:35:00.000Z",
          open: 102,
          high: 105,
          low: 101,
          close: 104,
          volume: 5000,
        },
        {
          date: "2026-06-13T15:05:00.000Z",
          open: 104,
          high: 106,
          low: 103,
          close: 105,
          volume: 3000,
        },
      ],
    });
    expect(reaction.gapPct).toBeCloseTo(0.02, 4);
    expect(reaction.reaction30mPct).not.toBeNull();
  });

  it("returns nulls for insufficient bars", () => {
    expect(
      computePostFilingReaction({
        filedAt: new Date().toISOString(),
        bars: [
          { date: "2026-01-01", open: 1, high: 1, low: 1, close: 1, volume: 1 },
        ],
      }).gapPct,
    ).toBeNull();
  });
});

describe("us-market-holidays", () => {
  it("detects NYSE holidays and formats keys", () => {
    expect(US_MARKET_HOLIDAYS.has("2026-01-01")).toBe(true);
    const holiday = new Date("2026-01-01T15:00:00.000Z");
    expect(isUsMarketHoliday(holiday)).toBe(true);
    expect(nyseHolidayKey(holiday)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("session-instrument-classes", () => {
  const brokers = [
    { supportedInstrumentClasses: ["stock", "crypto"] as const },
    { supportedInstrumentClasses: ["stock"] as const },
  ];

  it("resolves broker union and search-everything scope", () => {
    expect(resolveBrokerInstrumentClasses(brokers)).toEqual([
      "stock",
      "crypto",
    ]);
    const scope = buildSearchEverythingScope("crypto");
    expect(isSearchEverythingScope(scope)).toBe(true);
    expect(parseSearchEverythingFocusInstrumentClass(scope)).toBe("crypto");
  });

  it("enables search-everything only with ai picker", () => {
    const scope = buildSearchEverythingScope();
    expect(
      isSearchEverythingEnabled({
        instrumentScope: scope,
        selectorSettings: { aiPickerEnabled: true },
      }),
    ).toBe(true);
    expect(
      isSearchEverythingEnabled({
        instrumentScope: scope,
        selectorSettings: { aiPickerEnabled: false },
      }),
    ).toBe(false);
  });

  it("resolves effective classes from scope mode", () => {
    expect(
      resolveEffectiveInstrumentClasses(
        {
          instrumentClasses: ["stock"],
          instrumentScope: "Manual list",
          selectorSettings: { aiPickerEnabled: false },
        },
        brokers,
      ),
    ).toEqual(["stock"]);
  });
});

describe("experience-launchability", () => {
  const stockBroker = { supportedInstrumentClasses: ["stock"] as const };
  const cryptoBroker = { supportedInstrumentClasses: ["crypto"] as const };

  it("returns broker classes regardless of experience constraint", () => {
    expect(experienceBrokerOverlap([stockBroker])).toEqual(["stock"]);
    expect(experienceBrokerOverlap([stockBroker, cryptoBroker])).toEqual([
      "stock",
      "crypto",
    ]);
    expect(brokerOverlapsExperience(stockBroker)).toBe(true);
    expect(isSessionLaunchable([stockBroker])).toBe(true);
    expect(isSessionLaunchable([])).toBe(false);
  });

  it("returns broker classes for session instrument classes", () => {
    expect(
      resolveSessionInstrumentClasses(
        {
          signalSourceTypes: ["edgar_8k"],
          brokerRequirement: "any_supported_class",
        },
        {
          instrumentScope: buildSearchEverythingScope(),
          selectorSettings: { aiPickerEnabled: true },
        },
        [stockBroker, cryptoBroker],
      ),
    ).toEqual(["stock", "crypto"]);
  });
});

describe("search-providers", () => {
  it("identifies built-in DuckDuckGo provider", () => {
    const builtIn = buildBuiltInDuckDuckGoProviderAccount();
    expect(builtIn.id).toBe(BUILT_IN_DUCKDUCKGO_PROVIDER_ID);
    expect(isBuiltInSearchProviderAccount(builtIn)).toBe(true);
    expect(getSearchProviderDisplayName(builtIn.id)).toContain("DuckDuckGo");
  });
});
