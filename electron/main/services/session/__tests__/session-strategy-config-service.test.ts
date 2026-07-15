import { describe, expect, it, beforeEach } from "vitest";
import { AppError } from "@electron/shared/infra/errors";
import { defaultSessionStrategyConfigDoc } from "@electron/shared/domain/session-strategy-config-defaults";
import { SESSION_STRATEGY_CONFIG_SCHEMA_VERSION } from "@electron/shared/domain/session-strategy-config";
import { createTestDb } from "../../../db/test-helpers";
import { createMinimalSession } from "../../../db/test-fixtures";
import { SessionStrategyConfigService } from "../session-strategy-config-service";

describe("SessionStrategyConfigService", () => {
  let db = createTestDb();
  let service = new SessionStrategyConfigService(db);
  let sessionId = "";

  beforeEach(() => {
    db = createTestDb();
    service = new SessionStrategyConfigService(db);
    sessionId = createMinimalSession(db).id;
  });

  it("get returns versioned doc for a new session", () => {
    const record = service.get(sessionId);
    expect(record.version).toBe(1);
    expect(record.schemaVersion).toBe(SESSION_STRATEGY_CONFIG_SCHEMA_VERSION);
    expect(record.doc.risk.maxPositionUsd).toBeGreaterThan(0);
  });

  it("update bumps version and appends history", () => {
    const before = service.get(sessionId);
    const after = service.update(
      sessionId,
      { risk: { maxPositionUsd: 1234 } },
      before.version,
    );
    expect(after.version).toBe(before.version + 1);
    expect(after.doc.risk.maxPositionUsd).toBe(1234);

    const history = service.history(sessionId);
    expect(history).toHaveLength(1);
    expect(history[0]?.version).toBe(before.version);
    expect(history[0]?.doc.risk.maxPositionUsd).toBe(
      before.doc.risk.maxPositionUsd,
    );
  });

  it("rejects stale expectedVersion", () => {
    const before = service.get(sessionId);
    expect(() =>
      service.update(
        sessionId,
        { risk: { maxPositionUsd: 1 } },
        before.version,
      ),
    ).not.toThrow();

    try {
      service.update(
        sessionId,
        { risk: { maxPositionUsd: 2 } },
        before.version,
      );
      expect.unreachable("expected STALE_VERSION");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("STALE_VERSION");
    }
  });

  it("CAS race: only one of two concurrent writers commits", async () => {
    const before = service.get(sessionId);
    const errors: unknown[] = [];
    const results: number[] = [];

    await Promise.all(
      [1111, 2222].map(async (maxPositionUsd) => {
        try {
          const after = await Promise.resolve(
            service.update(
              sessionId,
              { risk: { maxPositionUsd } },
              before.version,
            ),
          );
          results.push(after.doc.risk.maxPositionUsd);
        } catch (err) {
          errors.push(err);
        }
      }),
    );

    expect(results).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect((errors[0] as AppError).code).toBe("STALE_VERSION");
    const final = service.get(sessionId);
    expect(final.version).toBe(before.version + 1);
    expect([1111, 2222]).toContain(final.doc.risk.maxPositionUsd);
  });

  it("rollback restores a prior history version", () => {
    const v1 = service.get(sessionId);
    const v2 = service.update(
      sessionId,
      { risk: { maxPositionUsd: 2000 } },
      v1.version,
    );
    const v3 = service.update(
      sessionId,
      { risk: { maxPositionUsd: 3000 } },
      v2.version,
    );
    expect(v3.doc.risk.maxPositionUsd).toBe(3000);

    const restored = service.rollback(sessionId, v1.version, v3.version);
    expect(restored.doc.risk.maxPositionUsd).toBe(v1.doc.risk.maxPositionUsd);
    expect(restored.version).toBe(v3.version + 1);
  });

  it("applyPreset merges by kind", () => {
    const preset = service.savePreset({
      name: "Aggressive risk",
      kind: "risk",
      doc: {
        schemaVersion: SESSION_STRATEGY_CONFIG_SCHEMA_VERSION,
        risk: {
          ...defaultSessionStrategyConfigDoc().risk,
          maxPositionUsd: 9999,
          riskPresetId: "aggressive",
        },
      },
    });

    const before = service.get(sessionId);
    const after = service.applyPreset(sessionId, preset.id, before.version);
    expect(after.doc.risk.maxPositionUsd).toBe(9999);
    expect(after.doc.risk.riskPresetId).toBe("aggressive");
    expect(after.doc.researchPosture).toEqual(before.doc.researchPosture);
  });

  it("refuses deleting builtin presets", () => {
    const builtin = service.savePreset({
      id: "risk/test-builtin",
      name: "Builtin",
      kind: "risk",
      builtin: true,
      doc: {
        schemaVersion: SESSION_STRATEGY_CONFIG_SCHEMA_VERSION,
        risk: defaultSessionStrategyConfigDoc().risk,
      },
    });
    expect(() => service.deletePreset(builtin.id)).toThrow(/Built-in/);
  });
});
