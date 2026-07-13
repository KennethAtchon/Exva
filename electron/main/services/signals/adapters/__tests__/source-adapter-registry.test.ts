import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  SourceAdapterRegistry,
  createSourceAdapterRegistry,
} from "../source-adapter-registry";
import type { SourceAdapterDefinition } from "../source-adapter-registry";
import { createTestDb } from "../../../../db/test-helpers";
import { CikTickerCache } from "../../cache/cik-ticker-cache";
import { CalendarEventsRepo } from "../../../../db/repositories/signals/calendar-events-repo";

function makeAdapter(
  kind: "mock",
): SourceAdapterDefinition<Record<string, unknown>> {
  return {
    kind,
    configSchemaVersion: 1,
    configSchema: z.record(z.unknown()),
    outputContractId: "signal/test",
    create(input) {
      return {
        id: input.definition.id,
        type: kind,
        status: "idle",
        lastError: null,
        start: async () => {},
        stop: async () => {},
        restart: async () => {},
        test: async () => ({ detected: 0, passed: 0, dropped: 0, errors: [] }),
        snapshot: () => ({
          lastPollAt: null,
          lastPollResult: null,
          lastSignalAt: null,
          lastSignalTicker: null,
          recentActivity: [],
        }),
        onSignal: () => {},
        offSignal: () => {},
      };
    },
  };
}

describe("SourceAdapterRegistry", () => {
  it("registers and retrieves an adapter", () => {
    const registry = new SourceAdapterRegistry();
    registry.register(makeAdapter("mock"));
    expect(registry.get("mock")).not.toBeNull();
    expect(registry.get("mock")?.kind).toBe("mock");
  });

  it("returns null for unregistered kind", () => {
    const registry = new SourceAdapterRegistry();
    expect(registry.get("edgar_8k")).toBeNull();
  });

  it("rejects duplicate registration", () => {
    const registry = new SourceAdapterRegistry();
    registry.register(makeAdapter("mock"));
    expect(() => registry.register(makeAdapter("mock"))).toThrow(
      /already registered/i,
    );
  });

  it("require() throws for an unregistered kind", () => {
    const registry = new SourceAdapterRegistry();
    expect(() => registry.require("edgar_8k")).toThrow(/not registered/i);
  });

  it("lists all registered adapters", () => {
    const registry = new SourceAdapterRegistry();
    registry.register(makeAdapter("mock"));
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0]?.kind).toBe("mock");
  });

  it("createSource() instantiates via the registered adapter", () => {
    const registry = new SourceAdapterRegistry();
    registry.register(makeAdapter("mock"));
    const source = registry.createSource("mock", {
      definition: { id: "src-1", config: {} },
      emit: async () => {},
    });
    expect(source.id).toBe("src-1");
    expect(source.type).toBe("mock");
  });

  it("createSource() throws for an unregistered kind", () => {
    const registry = new SourceAdapterRegistry();
    expect(() =>
      registry.createSource("prediction_event", {
        definition: { id: "x", config: {} },
        emit: async () => {},
      }),
    ).toThrow(/not registered/i);
  });

  describe("createSourceAdapterRegistry() wired factory", () => {
    function buildDb() {
      return createTestDb();
    }

    it("registers edgar_8k, mock, prediction_event, kalshi_market, calendar, news_rss, manual", () => {
      const db = buildDb();
      const cikCache = new CikTickerCache(db);
      const registry = createSourceAdapterRegistry({
        cikCache,
        calendarEventsRepo: new CalendarEventsRepo(db),
      });
      const kinds = registry.list().map((a) => a.kind);
      expect(kinds).toContain("edgar_8k");
      expect(kinds).toContain("mock");
      expect(kinds).toContain("prediction_event");
      expect(kinds).toContain("kalshi_market");
      expect(kinds).toContain("calendar");
      expect(kinds).toContain("news_rss");
      expect(kinds).toContain("manual");
      db.sqlite.close();
    });

    it("mock adapter creates a MockSignalSource", () => {
      const db = buildDb();
      const cikCache = new CikTickerCache(db);
      const registry = createSourceAdapterRegistry({
        cikCache,
        calendarEventsRepo: new CalendarEventsRepo(db),
      });
      const source = registry.createSource("mock", {
        definition: {
          id: "mock-test",
          config: { ticker: "NVDA", instrumentClass: "stock" },
        },
        emit: async () => {},
      });
      expect(source.id).toBe("mock-test");
      expect(source.type).toBe("mock");
      db.sqlite.close();
    });

    it("prediction_event adapter creates a PredictionEventSignalSource", () => {
      const db = buildDb();
      const cikCache = new CikTickerCache(db);
      const registry = createSourceAdapterRegistry({
        cikCache,
        calendarEventsRepo: new CalendarEventsRepo(db),
      });
      const source = registry.createSource("prediction_event", {
        definition: { id: "pe-test", config: {} },
        emit: async () => {},
      });
      expect(source.id).toBe("pe-test");
      expect(source.type).toBe("prediction_event");
      db.sqlite.close();
    });

    it("edgar_8k adapter creates an EdgarSignalSource", () => {
      const db = buildDb();
      const cikCache = new CikTickerCache(db);
      const registry = createSourceAdapterRegistry({
        cikCache,
        calendarEventsRepo: new CalendarEventsRepo(db),
      });
      const source = registry.createSource("edgar_8k", {
        definition: { id: "edgar-test", config: {} },
        emit: async () => {},
      });
      expect(source.id).toBe("edgar-test");
      expect(source.type).toBe("edgar_8k");
      db.sqlite.close();
    });

    it("manual adapter throws on create", () => {
      const db = buildDb();
      const cikCache = new CikTickerCache(db);
      const registry = createSourceAdapterRegistry({
        cikCache,
        calendarEventsRepo: new CalendarEventsRepo(db),
      });
      expect(() =>
        registry.createSource("manual", {
          definition: { id: "m", config: {} },
          emit: async () => {},
        }),
      ).toThrow(/implicit/i);
      db.sqlite.close();
    });

    it("all live source kinds have a configSchema with a version", () => {
      const db = buildDb();
      const cikCache = new CikTickerCache(db);
      const registry = createSourceAdapterRegistry({
        cikCache,
        calendarEventsRepo: new CalendarEventsRepo(db),
      });
      for (const adapter of registry.list()) {
        expect(adapter.configSchemaVersion).toBeGreaterThan(0);
        expect(adapter.configSchema).toBeDefined();
      }
      db.sqlite.close();
    });
  });
});
