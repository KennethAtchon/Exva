import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "../../db/test-helpers";
import {
  buildMockRehearsalConfigJson,
  ensureMockRehearsalSignalSource,
  parseMockRehearsalConfigJson,
  syncMockRehearsalSignalSourceTicker,
} from "../ensure-mock-rehearsal-signal-source";
import { SignalSourcesRepo } from "../../services/signals/repos/signal-sources-repo";
import { MOCK_REHEARSAL_SIGNAL_SOURCE_ID } from "@electron/shared/instruments/mock-rehearsal";

describe("ensureMockRehearsalSignalSource", () => {
  let db = createTestDb();

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.sqlite.close();
  });

  it("creates the global mock rehearsal source", () => {
    const repo = new SignalSourcesRepo(db);
    const source = ensureMockRehearsalSignalSource(repo, "NVDA");
    expect(source.id).toBe(MOCK_REHEARSAL_SIGNAL_SOURCE_ID);
    expect(source.type).toBe("mock");
    expect(parseMockRehearsalConfigJson(source.configJson).ticker).toBe("NVDA");
  });

  it("updates ticker when config changes", () => {
    const repo = new SignalSourcesRepo(db);
    ensureMockRehearsalSignalSource(repo, "NVDA");
    const updated = syncMockRehearsalSignalSourceTicker(repo, "SPY");
    expect(parseMockRehearsalConfigJson(updated.configJson).ticker).toBe("SPY");
  });

  it("builds config json with optional interval", () => {
    expect(
      JSON.parse(
        buildMockRehearsalConfigJson({
          ticker: "AMD",
          intervalMs: 60000,
        }),
      ),
    ).toEqual({
      ticker: "AMD",
      instrumentClass: "stock",
      intervalMs: 60000,
    });
  });
});
