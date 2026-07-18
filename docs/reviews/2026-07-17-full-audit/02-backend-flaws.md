# Backend Flaws — Main Process Audit (Targeted Pass)

Audit date: 2026-07-17. Audience: an executing AI agent.

### TLDR: shortcuts taken

- **This is a targeted pass, not the full deep audit.** The planned deep-dive subagent was cut short by a usage limit mid-run. Findings below are individually verified against real code; §6 lists the areas that still need a full pass — the fixer AI must run that checklist, not assume this doc is exhaustive.
- Kill-switch/order-path interaction (§3.4) is a verified _absence of evidence_ (no reference found in the order path) — the fixer must trace the actual submission flow before adding a gate, per the "verify before changing state" rule.
- Timer/WebSocket teardown (§3.5) was located but not fully traced.

### User journey

Not user-facing; no UI journey. The operator-visible outcome: no order ever leaves the app that a validation, risk, or kill-switch gate should have stopped, and no malformed data crashes the main process mid-session.

### Core decisions (sign-off required)

1. **Add schema validation to the shared IPC `handle()` wrapper** (every channel passes a Zod schema) vs per-handler discipline. Recommended: wrapper-level — one enforcement point, impossible to forget.
2. **Missing broker numbers become errors, not zeros.** Adapters currently coerce absent prices/quantities to `0` — recommended: fail the operation loudly instead. This may surface latent upstream gaps; that is the point.
3. **Add a last-mile kill-switch check at order submission** (after verifying §3.4). Recommended: yes — defense in depth on the money path.

---

## 1. What the backend is

The Electron main process owns everything privileged: IPC handlers (`electron/main/ipc/`, 49 files registered through a shared `handle()` wrapper), a service layer (`electron/main/services/`: session runtime, orchestration, pipeline, LLM adapters, risk, broker adapters over ccxt/Tradier/Coinbase, signals, operator tools, analytics), and SQLite via drizzle + better-sqlite3. The renderer is sandboxed and reaches all of this only through the typed preload bridge (`electron/preload/exva-api.ts`). Trading flow: signals → pipeline (selector → technical → fundamental → review → decision) → deterministic validation/risk/allocation/order-policy gates → broker adapters → persisted trades/traces.

## 2. What is already solid (don't "fix" these)

- **IPC sender trust:** `electron/main/ipc/handle.ts:19-42` rejects sub-frame and non-owned-window senders on every channel — Electron's recommended hardening, correctly applied at the single choke point.
- **Error hygiene:** zero empty catch blocks in `electron/main`; IPC errors are wrapped with stable `code`s for the renderer (`handle.ts:63-77`).
- **Log safety:** payload logging goes through `payloadMeta` (`services/infra/log-safety`) which reports sensitive-key detection instead of dumping payloads (`handle.ts:44-55`).
- **Order idempotency plumbing exists:** `clientOrderId` is part of the v2 order contract (`services/broker/order-contract-v2.ts:38,112,148`).

## 3. Verified findings

### 3.1 HIGH — IPC payloads are not schema-validated at the boundary

`handle()` (`electron/main/ipc/handle.ts:30-80`) passes `payload: unknown` straight to each handler. Only 8 of 49 IPC files import Zod at all; the rest cast/destructure unvalidated renderer input before it reaches services — including trading channels. A compromised or simply buggy renderer can send malformed shapes deep into the money path, failing wherever they land instead of at the boundary.
**Fix:** extend `handle()` to `handle(ipcMain, channel, schema, handler)` where `schema: z.ZodType<TIn>`; parse the payload, throw a typed `INVALID_PAYLOAD` IpcError on failure. Migrate channels mechanically (schemas largely exist in `electron/shared/` contracts); add an ESLint restriction so raw `ipcMain.handle` outside `handle.ts` is an error.

### 3.2 HIGH — 90 unguarded `JSON.parse` calls in the main process

`grep -rn "JSON.parse" electron/main --include="*.ts" | grep -v __tests__` → 90 sites. Each is a synchronous throw on corrupt input (DB rows written by an older schema, broker/API responses, persisted tool-call JSON). In long-running services a single bad row can kill a ticker loop or an orchestration step.
**Fix:** add `safeJsonParse<T>(raw, schema?): T | null` (with optional Zod validation) in `electron/main/services/infra/`; sweep all 90 sites, deciding per site: null-tolerate (logs warn) vs explicit error. Prioritize sites inside tickers, event feeds, and the pipeline loop.

### 3.3 HIGH — broker adapters coerce missing market data to zero

`Number(x ?? 0)` pattern on money-relevant fields: `services/broker/adapters/coinbase-advanced-trade-adapter.ts:50` (balance total), `:152` (price = `Number(ticker.last ?? ticker.close ?? ticker.bid ?? 0)`), `:200-217` (filled average price fallback chain ending in 0), `tradier-adapter.ts:140,145,169` (quantity, cost basis, last price). A ticker outage or unexpected API shape silently yields price/balance `0`, which then flows into notional, PnL, and risk calculations — worst case, a "0 price" makes a position look free or a balance look empty and downstream gates act on it.
**Fix:** in each adapter, replace `?? 0` fallbacks on price/qty/balance with explicit validation: if the field is absent/NaN/<=0 where positive is required, throw a typed `BrokerDataError` (see `services/broker/broker-errors.ts` for the existing error taxonomy) so the instrumented adapter layer records it and the caller retries or aborts. Add adapter unit tests feeding malformed ticker/order payloads.

### 3.4 HIGH (verify first) — no kill-switch check in the order submission path

`grep killSwitch` across `services/orchestration` and `services/broker` returns nothing outside the operator service itself. The kill switch (`services/operator/kill-switch-service.ts`) pauses sessions / flattens positions, but nothing at the broker-submission layer re-checks a halt flag — so an order already in flight through the pipeline when the switch is thrown may still submit.
**Fix:** first trace the actual flow (orchestrator → order policy → broker-service.submit) and confirm the gap. If confirmed: give `KillSwitchService` a synchronous `isHalted()` and check it inside `broker-service` immediately before adapter submission, rejecting with a typed error. Add a test: engage kill switch between decision and submission; assert the order is refused.

### 3.5 MEDIUM (partially verified) — timer/feed lifecycle

Interval timers exist in `services/research/label-builder-ticker.ts:25`, `drift-monitor-ticker.ts:33`, `broker/broker-balance-ticker.ts:19`, `broker/order-event-feed.ts:72,92`, and a WebSocket ping timer in `broker/streaming-order-event-feed.ts:69`. Teardown paths were not fully traced in this pass.
**Fix:** for each, verify stop/dispose clears the timer and that error paths inside the callback can't kill the loop silently (wrap callback bodies in try/catch + logger). Verify the streaming feed clears `pingTimer` on close/error and that reconnect doesn't stack multiple ping timers.

### 3.6 MEDIUM — README documentation rot

`README.md` "Important Docs" points at `docs/USAGE.md`, `docs/folder-structure.md`, `docs/architecture/electron.md`, `docs/architecture/ai-runtime.md`, `docs/architecture/pipeline-runtime.md` — **none of these files exist** (verified). For an AI-operated repo this is actively harmful: agents will trust and chase dead references.
**Fix:** either restore/rewrite those docs or update the README links to what actually exists (`docs/engineering/`, `docs/specs/`, `docs/plans/`).

### 3.7 Control-agent backend defects (cross-reference)

Verified in `03-ai-capability-parity.md` §5 and owned by that doc's execution: confirmation deadlock without timeout, live-risk gating via regex on prose, `start/resume_session` missing live-mode risk annotation, scope never enforced in `runCapability`, tool results absent from replayed history.

## 4. Severity order for the fixer AI

1. §3.3 broker zero-coercion (money correctness)
2. §3.4 kill-switch gate (verify, then fix)
3. §3.1 IPC schema validation
4. §3.2 JSON.parse sweep (tickers/pipeline first)
5. §3.5 timer/feed lifecycle verification
6. §3.6 README links

Money-path changes require `bun run check` + `bun run test:smoke` (and `bun run prove` for the trade loop) before being considered landed.

## 5. What was NOT audited — rerun checklist

A future deep pass (fresh session) must still cover:

- Orchestration/pipeline race conditions and state-machine gaps (`services/orchestration`, `services/pipeline`) — unread in this pass.
- Drizzle schema: transaction boundaries around multi-row money writes, missing indexes on hot queries, migration discipline.
- Secrets: keytar usage audit; confirm no key material reaches pino logs or persisted traces (log-safety helps at IPC, but service-level logging was not swept).
- Unhandled promise rejections: `void`-ed async calls in services; global `process.on("unhandledRejection")` posture.
- Risk/allocation gate logic correctness (`services/risk`) — the actual math was not reviewed.
- Test honesty: whether `scripts/prove-trade-loop.ts` and the smoke suite exercise the real broker adapter path or only mocks.
