# Solution 01 - Prove the Alpaca Paper Order Path

> **Outcome:** One deliberate `$10` SPY paper round trip appears in Exva and Alpaca with correlated
> client order ID, broker order ID, fills, and terminal status.
> **Safety:** Paper only. This is infrastructure certification, not alpha.

Implements: docs/engineering/CODING_GUIDELINES.md

## Why This Is First

The normal path has never produced a persisted order attempt. Continuing to debug signals without a
known-good order lifecycle mixes two questions: “did the strategy want a trade?” and “can Exva place
and reconcile one?” This solution answers the second question independently.

The existing `SignalBus.debugForceTrade()` is close but insufficient. It bypasses the signal pipeline
and explicitly does not create an Exva trade row. It can make Alpaca show activity while Exva still
looks dead.

## What Already Exists

`scripts/prove-trade-loop.ts` (558 lines, wired to `bun run prove` and `bun run check:proof`) is the
existing proof harness. Read its three modes before building anything, because two of them are already
what this solution needs and one of them is the gap:

| Mode             | What it does                                                                       | Gap                                   |
| ---------------- | ---------------------------------------------------------------------------------- | ------------------------------------- |
| `mock` (default) | Golden-path mock trade rehearsal against a scratch DB; runs in `check:proof`       | Never touches a real broker           |
| `polymarket`     | Signal → decision → ghost order → fill → forced restart → rehydration → settlement | Ghost fills only, by design           |
| `alpaca`         | **Read-only audit** of a real Alpaca paper trade already recorded in the DB        | **Cannot create the trade it audits** |

The script's own header is explicit: "keys gate access only — this mode never calls Alpaca HTTP or
places orders." So Exva can already _verify_ an Alpaca paper round trip and has never been able to
_produce_ one. That is precisely the missing link this solution supplies.

Therefore: do not build a parallel proof script. Add the certification service, then extend the harness
with `--mode=certification`, which arms a run, waits for terminal state, and then hands off to the
existing `alpaca` audit logic for verification. The audit code is the acceptance check; reuse it.

## User Journey

1. Open the paper certification panel.
2. See the selected paper broker, symbol, notional, market state, and safety checks.
3. Click **Arm paper certification**.
4. Confirm one `$10` SPY buy and automatic close.
5. Watch states advance: `armed -> submitted -> accepted/new -> partially_filled/filled -> closing -> closed`.
6. Open the visible certification trade in Exva.
7. Open Alpaca and find the same broker order IDs.
8. See a reconciliation receipt showing Exva quantity equals Alpaca quantity and both are flat.

If the regular market is closed, the panel shows the next eligible window and does not submit.

## Domain Contract

Add `electron/shared/domain/paper-certification.ts`:

```ts
export const paperCertificationStatusSchema = z.enum([
  "armed",
  "submitting_entry",
  "entry_open",
  "entry_filled",
  "submitting_exit",
  "exit_open",
  "closed",
  "failed",
  "reconciliation_required",
]);

export interface PaperCertificationRun {
  id: string;
  sessionId: string;
  brokerAccountId: string;
  symbol: "SPY";
  notionalUsd: 10;
  status: z.infer<typeof paperCertificationStatusSchema>;
  entryClientOrderId: string;
  entryBrokerOrderId: string | null;
  exitClientOrderId: string | null;
  exitBrokerOrderId: string | null;
  filledQuantity: number;
  failureCode: string | null;
  failureMessage: string | null;
  armedAt: string;
  completedAt: string | null;
}
```

## Persistence

Add:

```text
paper_certification_runs
order_intents
broker_order_events
broker_fills
```

Add `origin_kind` to `trades` with values `strategy | certification`; existing rows read as
`strategy`. Certification rows remain visible in the trade list with a **CERTIFICATION** badge and are
excluded from strategy expectancy, leaderboard, autopsy, and promotion queries.

Call synchronous adapter `prepareClientOrderId()` and transactionally persist canonical
`order_intents.client_order_id` plus exact `wire_client_order_id` before any broker HTTP call. Add
unique indexes on `(broker_account_id, client_order_id)` and
`(broker_account_id, wire_client_order_id)`.

## Service Design

Add `electron/main/services/certification/paper-certification-service.ts` with:

```ts
arm(input: {
  sessionId: string;
  brokerAccountId: string;
}): Promise<PaperCertificationRun>

get(runId: string): PaperCertificationRun

reconcile(runId: string): Promise<PaperCertificationRun>
```

`arm()` must:

1. Require global workspace `paper`.
2. Require session execution mode `paper_only`.
3. Require broker account mode `paper` and broker type `alpaca`.
4. Reject when the kill switch is engaged.
5. Run broker reachability, allocation, account-state, asset, and market-hours checks.
6. Reject more than one completed certification per broker account per UTC day.
7. Persist run and entry intent transactionally.
8. Submit entry once.
9. Reconcile by stream or the persisted broker-wire client ID until terminal.
10. Persist the visible trade after the first fill.
11. Submit an exit for exactly the filled quantity.
12. Reconcile to flat and emit `paper_certification_updated` events.

The service may reuse broker routing and policy helpers, but it must not call AI, strategy edge, or
Kelly sizing. It must retain environment, asset, market-hours, duplicate-order, account, and kill-
switch controls.

## Alpaca Contract

- Base URL must be `https://paper-api.alpaca.markets`.
- Default asset is active/tradable SPY.
- Entry is a regular-hours market order for `$10` notional.
- Exit uses the actual filled fractional quantity.
- `accepted` or `new` is not a fill.
- Partial fills persist individually and the close quantity equals cumulative filled quantity.
- Submission timeout triggers lookup by exact broker-wire client order ID before any retry.
- Terminal failure leaves a reconciliation action; it never creates a second blind order.

Alpaca paper does not model market impact, queue position, realistic liquidity, or full live costs.
The receipt says “integration certified,” never “strategy validated.”

## Broker Wrapper Prerequisite

Before the remote smoke, expose Alpaca's canonical-to-wire normalization as synchronous
`prepareClientOrderId()` and add raw Alpaca lookup by the resulting wire client order ID. Both IDs
must exist durably before submission can begin. `createInstrumentedBrokerAdapter()` must then preserve
the preparation/lookup methods plus existing `placeOrderV2`, order-event feed, and option-chain
capabilities. Add a test that fails if any known optional broker method disappears through
instrumentation. Do not assume open-order listing or client-ID lookup already exists.

## IPC and UI

Add shared channels:

```text
paperCertification.arm
paperCertification.get
paperCertification.reconcile
```

The preload uses exact shared schemas. Add `paper-certification-panel.tsx` under the Sessions/Dev
surface. The confirmation copy must contain broker account name/ID, `SPY`, `$10`, paper-only state,
automatic close, and the statement that this is not a strategy trade.

## Tests

### Unit

- Reject live workspace, live session, and live broker independently.
- Reject closed market without creating an intent.
- Persist intent before adapter invocation.
- Persist canonical and wire client IDs before adapter HTTP invocation.
- Timeout reconciles by client ID and does not duplicate.
- Partial entry fills produce matching exit quantity.
- Certification rows are excluded from alpha analytics.
- `originKind = "certification"` propagates from planted fact through intent and trade.

### Composition

Use a real service, repos, routing, instrumented adapter, and event bus with only Alpaca HTTP/time
faked. Drive `arm()` through entry partial fill, final fill, exit fill, trade update, and flat
reconciliation.

### E2E

Arm from the renderer against a Mock-backed fixture, display each state, open the trade detail, and
verify the receipt after renderer remount.

## Paper Smoke Runbook

Prerequisite: unify the Alpaca secret environment variable name first. `electron/main/config/env.ts`,
`scripts/backfill-bars.ts`, and `scripts/prove-trade-loop.ts` all read `ALPACA_SECRET_KEY`, while
`scripts/cert-broker.ts` reads `ALPACA_API_SECRET`. The certification runbook must not depend on which
script the operator happened to run.

1. Confirm the app and target session show `paper`/`paper_only`.
2. Confirm `seed-alpaca-paper` connection and account reads pass.
3. Confirm market is regular-hours open.
4. Arm one certification.
5. Record Exva run ID, trade ID, entry/exit client IDs, and broker IDs.
6. Verify both Alpaca orders and fills.
7. Verify Exva and Alpaca are flat.
8. Run `bun run prove -- --mode=alpaca` against the same DB; the read-only audit must pass on the
   certification trade without modification to its existing consistency checks.
9. Save the generated receipt under `docs/reviews/`.

## Acceptance Criteria

- [ ] No code path can arm against a live account.
- [ ] Exactly one entry intent and one exit intent exist.
- [ ] Exva and Alpaca display correlated broker IDs.
- [ ] Every partial fill is durable.
- [ ] Final Exva and Alpaca quantities are zero.
- [ ] Certification trade is visible but excluded from alpha metrics.
- [ ] Restart during entry or exit resumes reconciliation without duplicate submission.
- [ ] The receipt explicitly labels paper-simulation limitations.
- [ ] `bun run prove -- --mode=alpaca` audits the certification trade and passes.
- [ ] The Alpaca secret environment variable name is identical across every script and the app.
