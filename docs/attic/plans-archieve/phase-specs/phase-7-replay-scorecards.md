# Phase 7 Spec — Replay and Paper Scorecards

> **Status:** Not started — depends on Phase 6 (`exit_reason` field on trades)
> **Files to create:**
>
> - `electron/main/services/orchestration/cycle-replay-service.ts`
> - `electron/main/services/analytics/paper-scorecard-service.ts`
>   **Files to modify:**
> - `electron/main/ipc/` (add replay and scorecard IPC handlers)

---

## Goal

A complete agent cycle can be exported as a self-contained JSON fixture. The fixture can be replayed deterministically without live providers. A scorecard aggregates all closed paper/mock trades for a session into a performance report that exposes whether the strategy is sound before enabling live mode.

---

## 1. Cycle Fixture Format

```ts
// electron/main/services/orchestration/cycle-replay-service.ts

export interface CycleFixture {
  version: 1;
  exportedAt: string; // ISO-8601
  sessionId: string;
  cycleId: string;
  strategySnapshot: StrategySnapshot; // existing type from domain.ts

  // What the selector found
  selectedInstruments: Array<{
    symbol: string;
    instrumentClass: InstrumentClass;
    rationale: string;
  }>;

  // Market data used during the cycle
  marketData: Array<{
    symbol: string;
    quote: MarketSnapshot; // snapshot at decision time
    ohlcvBars: MockOhlcvBar[];
    newsHeadlines: string[];
    redditPosts: Array<{ body: string; score: number }>;
  }>;

  // AI pipeline outputs (from agent_messages)
  agentRuns: Array<{
    role: AgentRole;
    modelId: string;
    promptSummary: string; // first 200 chars of prompt
    outputSummary: string; // first 200 chars of output
    toolCalls: Array<{ tool: string; argsJson: string; resultJson: string }>;
  }>;

  // Decision
  decision: {
    action: "trade" | "no_trade";
    side?: "BUY" | "SELL";
    symbol?: string;
    sizeUsd?: number;
    confidence: number;
    reasoning: string;
  };

  // Risk gate outcome
  riskOutcome: {
    allowed: boolean;
    reason?: string;
    gatesFailed?: string[];
  };

  // Order + trade (null if no trade)
  trade: {
    id: string;
    brokerOrderId: string;
    entryPrice: number;
    sizeUsd: number;
    exitPrice?: number;
    realizedPnlUsd?: number;
    exitReason?: string;
    openedAt: string;
    closedAt?: string;
  } | null;
}
```

---

## 2. `CycleReplayService`

```ts
export class CycleReplayService {
  /**
   * Build a CycleFixture from persisted DB records for the given cycleId.
   * Returns null if the cycle is incomplete (selector never finished).
   */
  buildFixture(cycleId: string): CycleFixture | null;

  /**
   * Persist the fixture as a JSON file in the configured replay directory.
   * Default path: `{userData}/replays/{sessionId}/{cycleId}.json`
   */
  saveFixture(fixture: CycleFixture): string; // returns absolute file path

  /**
   * Load a previously saved fixture from disk.
   */
  loadFixture(filePath: string): CycleFixture;
}
```

### `buildFixture` data sources

| Fixture field         | Source                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| `strategySnapshot`    | `SessionStrategyContextService.get(sessionId)` serialized                                          |
| `selectedInstruments` | `InstrumentCacheRepo.get(sessionId)` or events with `cycleId`                                      |
| `marketData.quote`    | `EventsRepo` or `AgentMessagesRepo` — tool call results for `get_quote` / `get_ohlcv` in the cycle |
| `agentRuns`           | `AgentMessagesRepo.listByCycle(cycleId)`                                                           |
| `decision`            | From the `decision_maker` agent run output (last message in that run)                              |
| `riskOutcome`         | From `session_execution_steps` where `stage = "risk_gate"`                                         |
| `trade`               | `TradesRepo.listByCycle(cycleId)` (add this query if not present)                                  |

The fixture is a **snapshot** — it does not need to be 100% complete for every field. Missing fields are null/empty. Incomplete cycles still produce partial fixtures useful for debugging.

---

## 3. Deterministic Replay

The replay runner re-runs `CandidateValidationService`, `OrderPolicyGate`, and `ExitPolicyEvaluator` against the fixture's market data and strategy snapshot — without calling any live AI, broker, or data provider.

```ts
export class CycleReplayRunner {
  replay(fixture: CycleFixture): ReplayResult;
}

export interface ReplayResult {
  cycleId: string;
  candidateValidation: CandidateValidationResult[];
  policyGate: PolicyGateResult | null;
  exitDecision: ExitDecision | null;
  matchesOriginal: {
    riskOutcomeMatches: boolean; // replay risk == stored risk outcome
    tradeOpenedMatches: boolean; // replay says trade vs. stored trade record
  };
}
```

The replay does **not** re-run AI models. It replays only the deterministic layers. Differences between replay and original indicate that a gate was added or changed since the cycle ran.

---

## 4. `PaperScorecardService`

```ts
// electron/main/services/analytics/paper-scorecard-service.ts

export interface TradeScorecard {
  sessionId: string;
  strategyPresetLabel: string;
  generatedAt: string; // ISO-8601
  tradeCount: number;
  winCount: number;
  lossCount: number;
  winRate: number; // 0.0–1.0
  avgWinUsd: number;
  avgLossUsd: number;
  expectancy: number; // (winRate * avgWin) - (lossRate * avgLoss)
  profitFactor: number; // grossWins / grossLosses; Infinity if no losses
  netPnlUsd: number; // sum of realizedPnlUsd across all trades
  netPnlAfterCostsUsd: number; // netPnlUsd - totalAiSpendUsd - totalDataSpendUsd
  totalAiSpendUsd: number;
  totalDataSpendUsd: number;
  maxDrawdownUsd: number; // largest peak-to-trough in cumulative PnL
  maxDrawdownPct: number; // maxDrawdownUsd / peakEquity
  tradeFrequency: number; // trades per day (using first/last trade timestamps)
  avgHoldHours: number;
  exitReasonBreakdown: Record<string, number>; // exitReason → count
  rejectionReasonBreakdown: Record<string, number>; // gate name → rejection count
  scenarioCoverage: Partial<Record<MockScenarioKind, number>>; // scenario → trade count
}

export class PaperScorecardService {
  generate(sessionId: string): TradeScorecard;
}
```

### `maxDrawdown` calculation

```ts
// Walk cumulative PnL series; track peak; record largest dip from peak

let peak = 0;
let maxDrawdown = 0;
let cumPnl = 0;
for (const trade of closedTradesChronological) {
  cumPnl += trade.realizedPnlUsd;
  if (cumPnl > peak) peak = cumPnl;
  const drawdown = peak - cumPnl;
  if (drawdown > maxDrawdown) maxDrawdown = drawdown;
}
```

### Data sources

| Field           | Source                                                                              |
| --------------- | ----------------------------------------------------------------------------------- |
| Trades          | `TradesRepo.listClosed(sessionId)` sorted by `closed_at`                            |
| AI spend        | `ApiCallLogRepo.list({ sessionId })` summing `cost_usd` where `log_type = "ai"`     |
| Data spend      | `ApiCallLogRepo.list({ sessionId })` summing `cost_usd` where `log_type = "data"`   |
| Rejection count | `SessionExecutionStepsRepo.getLatestBySession(sessionId)` where `status = "failed"` |

---

## 5. IPC Handlers

```ts
// session:buildCycleFixture
Request: {
  sessionId: string;
  cycleId: string;
}
Response: {
  fixture: CycleFixture | null;
}

// session:saveCycleFixture
Request: {
  sessionId: string;
  cycleId: string;
}
Response: {
  filePath: string;
}

// session:getPaperScorecard
Request: {
  sessionId: string;
}
Response: {
  scorecard: TradeScorecard;
}
```

---

## 6. Live Promotion Criteria

`PaperScorecardService` exposes a `meetsPromotionCriteria(scorecard, thresholds)` helper used by `LiveReadinessService` (Phase 8):

```ts
export interface PromotionThresholds {
  minTradeCount: number; // default: 100
  minWinRate: number; // default: 0.4 (not the primary criterion)
  minExpectancy: number; // default: 0.0 (positive after costs)
  maxDrawdownPct: number; // default: 0.20 (20%)
  requiredScenarioCoverage: MockScenarioKind[]; // must have ≥1 trade in each
}

export function meetsPromotionCriteria(
  scorecard: TradeScorecard,
  thresholds: PromotionThresholds,
): { meets: boolean; failedCriteria: string[] };
```

---

## 7. Acceptance Tests

```
describe("CycleReplayService.buildFixture")
  ✓ builds fixture from persisted agent messages + trade record
  ✓ incomplete cycle (no trade) → fixture.trade = null, fixture still valid
  ✓ fixture JSON round-trips without data loss

describe("CycleReplayRunner.replay")
  ✓ same fixture produces same riskOutcome on two consecutive runs
  ✓ fixture from before policy gate was added → matchesOriginal.riskOutcomeMatches can be false

describe("PaperScorecardService.generate")
  ✓ 10 trades: 6 wins $50, 4 losses $30 → winRate=0.6, expectancy=(0.6*50)-(0.4*30)=18
  ✓ profitFactor = (6*50)/(4*30) = 300/120 = 2.5
  ✓ cumulative PnL series: [50,100,70,120,90,140,110,160,130,180] → maxDrawdown=30 (140→110)
  ✓ netPnlAfterCostsUsd = netPnlUsd - (aiSpend + dataSpend)

describe("meetsPromotionCriteria")
  ✓ tradeCount < 100 → failedCriteria includes "minTradeCount"
  ✓ expectancy < 0 → failedCriteria includes "minExpectancy"
  ✓ maxDrawdownPct > 0.20 → failedCriteria includes "maxDrawdownPct"
  ✓ missing scenario coverage → failedCriteria includes the missing scenario kind
  ✓ all criteria met → meets=true, failedCriteria=[]
```
