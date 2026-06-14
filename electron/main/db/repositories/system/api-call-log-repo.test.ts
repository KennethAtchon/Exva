import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test-helpers";
import { createMinimalSession } from "../../test-fixtures";
import { ApiCallLogRepo } from "./api-call-log-repo";

describe("ApiCallLogRepo", () => {
  it("inserts entries and aggregates daily spend", () => {
    const db = createTestDb();
    const repo = new ApiCallLogRepo(db);
    const session = createMinimalSession(db);
    const today = new Date().toISOString();

    repo.insert({
      id: "api-1",
      session_id: session.id,
      trade_id: null,
      cycle_id: "cycle-1",
      provider: "polygon",
      endpoint: "/v2/aggs",
      call_type: "market_data",
      credits_used: 1,
      cost_usd: 0.02,
      latency_ms: 120,
      status: "ok",
      from_cache: false,
      created_at: today,
    });

    expect(repo.dailyDataSpendUsd(session.id)).toBeCloseTo(0.02, 6);
    expect(
      repo.listByScope({ sessionId: session.id, cycleId: "cycle-1" }),
    ).toMatchObject([{ provider: "polygon", cost_usd: 0.02 }]);

    db.sqlite.close();
  });
});
