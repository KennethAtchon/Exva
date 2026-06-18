import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "../../../db/test-helpers";
import { EventBus } from "../../infra/event-bus";
import { SignalBus } from "../signal-bus";
import { InstrumentNormalizer } from "../../broker/instrument-normalizer";
import { SignalSourceRegistry } from "../signal-source-registry";
import { SignalDeadLettersRepo } from "../repos/signal-dead-letters-repo";
import { SignalDeliveriesRepo } from "../repos/signal-deliveries-repo";
import { SignalEventsRepo } from "../repos/signal-events-repo";
import { SignalSourcesRepo } from "../repos/signal-sources-repo";

describe("SignalSourceRegistry", () => {
  let db = createTestDb();

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.sqlite.close();
  });

  function createRegistry() {
    const bus = new SignalBus(
      new SignalEventsRepo(db),
      new SignalDeliveriesRepo(db),
      new SignalDeadLettersRepo(db),
      new SignalSourcesRepo(db),
      { get: () => null, getStatus: () => "active" } as never,
      { listBrokerAccountIds: () => [] } as never,
      { get: () => null } as never,
      { resolveAdapter: async () => ({ adapter: {} }) } as never,
      new EventBus(),
      new InstrumentNormalizer(),
    );
    return new SignalSourceRegistry(db, bus);
  }

  it("instantiates timer sources and exposes runtime snapshots", async () => {
    const registry = createRegistry();
    const record = new SignalSourcesRepo(db).create({
      id: "timer-runtime",
      type: "timer",
      name: "Timer",
      description: null,
      enabled: true,
      configJson: JSON.stringify({ symbol: "SPY", cadence: "15m" }),
    });

    registry.create(record);
    await registry.start(record.id);

    expect(registry.status(record.id)).toMatchObject({ status: "running" });
    expect(await registry.test(record.id)).toMatchObject({ passed: 1 });
    expect(registry.snapshot(record.id)?.lastSignalTicker).toBe("SPY");

    await registry.stop(record.id);
    expect(registry.status(record.id)?.status).toBe("paused");
  });

  it("restarts sources with updated config", async () => {
    const registry = createRegistry();
    const record = new SignalSourcesRepo(db).create({
      id: "mock-runtime",
      type: "mock",
      name: "Mock",
      description: null,
      enabled: true,
      configJson: JSON.stringify({ ticker: "NVDA" }),
    });
    registry.create(record);

    await registry.restart(record.id, { ticker: "AMD" });
    await registry.test(record.id);

    expect(registry.snapshot(record.id)?.lastSignalTicker).toBe("AMD");
  });

  it("removes runtime instances", async () => {
    const registry = createRegistry();
    const record = new SignalSourcesRepo(db).create({
      id: "remove-me",
      type: "web_search",
      name: "Web",
      description: null,
      enabled: true,
      configJson: "{}",
    });

    registry.create(record);
    await registry.remove(record.id);
    expect(registry.get(record.id)).toBeNull();
  });
});
