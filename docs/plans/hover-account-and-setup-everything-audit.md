# Hover Accounts for Polymarket + `setup-everything.md` Executability Audit

Addresses `docs/plans/index.md`:

1. We already do "hover trades" (ghost orders) for Polymarket — build the missing
   "hover **account**" (credential-free paper Polymarket broker) with actual-outcome
   tracking.
2. Audit of `docs/prompts/setup-everything.md` for things that make it impossible
   to execute as intended, and the rewritten ideal prompt.

This is an **execution plan for an AI agent**. Every change lists the exact file,
symbol, edit, and acceptance check. Line numbers were read on 2026-07-18 — anchor
on symbols, not line numbers, when the file has drifted.

**Deliverables:**
- Code changes 1–5 below.
- `docs/prompts/setup-everything-v2.md` (already written, sits next to the old one).
  After changes 1–5 land and verification passes, replace `setup-everything.md`
  with the v2 content and delete the v2 file.

### TLDR: shortcuts taken

- Runtime behavior claims come from reading code, not from running the app. Notably: I believe the Add-Broker UI *already* accepts blank Polymarket fields in paper mode (`serializeBrokerCredentials` fills `""`, paper `testConnection` never touches creds) — but I did not launch the app to confirm. Executor must verify in Step 3.
- I verified there is no broker `mode` edit path (broker `updateSettingsSchema` has no `mode` field), so "block paper→live flips" became an invariant to preserve, not code to write. If a mode-edit surface exists somewhere I didn't find, Step 2's guard analysis is incomplete.
- `getBalance` default-row behavior in `paper-balances-repo.ts` was inferred from `DEFAULT_PAPER_STARTING_BALANCE_USD` usage, not read line-by-line.
- Effort estimates are gut numbers.
- Kraken paper mode shares the same paper repos and may deserve the same treatment; explicitly out of scope here.

### User journey

> Ken opens Settings → Brokers → Add broker → picks "Polymarket (prediction
> markets)" while the workspace is in Paper mode. Instead of private-key/funder
> fields he sees: "Paper (hover) mode — no credentials required. Orders fill
> locally against live Polymarket prices; balance is virtual." He names it, Test
> shows "Polymarket ghost (paper) mode — market data live, orders local", Save
> works. The account starts with a $1,000 paper balance (resettable to up to $10M
> via the existing reset-paper-balance action). He creates a
> `prediction-event-edge` session, routes it to this account, starts it. Ghost
> orders fill against the live CLOB book; when a market resolves on gamma-api the
> position auto-settles at the real 0/1 outcome and the paper balance is
> credited. Fresh installs get this for free: `seed-polymarket-paper` exists out
> of the box, so the stress-test operator finds it via `list_brokers` and the
> Polymarket branch runs instead of reporting "blocked".

### Core decisions (sign-off required)

1. **Optional credentials for `mode: "paper"` Polymarket** (adapter + registry + UI), not a hardcoded fake adapter and not an AI-side `create_broker` tool. Recommended: smallest change, keeps "credentials are UI-only" true, and the paper path already never uses creds.
2. **Seed `seed-polymarket-paper` unconditionally** (except under vitest, matching the Alpaca seed's test-guard). Recommended: it needs no secret, so unlike the Alpaca/OpenRouter seeds there is nothing to gate on. Decline if you want broker creation to always be an explicit user act — then skip Step 4 and the v2 prompt's "if missing" fallback covers it.
3. **Credential-less accounts must never trade live.** Today this is structurally guaranteed (broker mode is fixed at creation to the workspace `environmentMode`; `updateSettings` cannot change `mode`). The live code path also throws `BROKER_ERROR` on blank creds (`createAuthedClient`). Sign off on preserving both: any future broker-mode-edit feature must require credentials + a passing live connection test.
4. **Do NOT let the generic `mock` broker satisfy `prediction-event-edge`.** The `polymarket_broker` requirement (`write-service.ts` `validate`) stays. Mock fabricates prices; the hover account uses real books and real resolutions — that separation is what makes outcome tracking honest.
5. **`setup-everything.md` is replaced by the v2 content only after Steps 1–5 verify.** Until then the old prompt stays, because it accurately describes the current (blocked) system.

---

## Part 0 — System facts the executor needs (all verified in code)

**What already exists — do not rebuild any of this:**

| Piece | Where | Behavior |
|---|---|---|
| Ghost fills | `electron/main/services/broker/mock/ghost-fill-simulator.ts`; used at `polymarket-adapter.ts` field `ghosts` | Marketable orders fill against real live quotes; non-marketable rest and re-check on fresh quotes. Paper mode "never posts to the CLOB" |
| Paper balance | `electron/main/db/repositories/brokers/paper-balances-repo.ts` | Per-account persisted USD; `DEFAULT_PAPER_STARTING_BALANCE_USD = 1_000`; debit on fill, credit on close/settle; reset IPC exists (`broker-accounts.ts` `resetPaperBalance`, max $10M) |
| Position persistence | `paper-positions-repo.ts` | Ghost positions survive restart; rehydrated on adapter rebuild (`PolymarketAdapterOptions.paperPositions` doc comment) |
| Actual-outcome settlement | `polymarket-adapter.ts` — `readResolutionSettlement`, gamma-api fetch in the parity check, auto-settle when `resolutionTime` passes | Resolved markets settle at the real 0/1 price; unresolved close marks-to-market at last trade; settle result carries `resolved: boolean` |
| Parity checks | `polymarket-adapter.ts` gamma fetch → `onParityWarning` → `broker-registry.ts` wires to `supervisor.raiseParityCheckFailed` | Ghost-vs-reality divergence surfaces as supervisor warnings |
| Standalone proof | `scripts/prove-trade-loop.ts`, `provePolymarket()` (`bun run prove -- --mode=polymarket`) | signal → decision → ghost → persisted fill → adapter rebuild ("restart") → settlement, on a scratch DB |

**The gap, precisely:**

- `PolymarketAdapter` constructor takes `PolymarketCredentials` with **required** `privateKey`/`funderAddress` (`polymarket-adapter.ts`), but in paper mode only ever uses `getReadOnlyClient()` — an **unauthenticated** `ClobClient` — plus raw `fetch` to public `gamma-api.polymarket.com`. Credentials are only read inside `createAuthedClient()`, which is lazy and live-path-only, and which already throws a structured `AppError("...require private key and funder address.", "BROKER_ERROR")` when they're blank.
- `BrokerRegistry.get()` throws `MISSING_SECRET` for any non-`mock` account with no stored secret. So a **seeded** Polymarket row (which can't store a secret at seed time) can never build an adapter.
- The Add-Broker UI (`src/components/accounts/AddBrokerModal.tsx`, `CredentialFields`) always renders "Polygon private key" + "funder/profile address" for Polymarket with no mode awareness and no hint that paper doesn't need them. (`serializeBrokerCredentials` in `electron/main/ipc/trading/broker-account-helpers.ts` already tolerates blanks — it fills `""` — so the blank-field UI path *probably* works today; nobody knows that, and it's unverified.)
- `seed.ts` (`runSeed`) seeds no Polymarket account, there is no broker-creation control tool (verified across `electron/main/services/control/capabilities*.ts`), and `prediction-event-edge` hard-requires `brokerType === "polymarket"` (`SessionWriteService.validate`, the `polymarket_broker` branch). Net: the stress-test prompt's Polymarket branch is unreachable on a fresh install.

**Key wiring facts:**

- Broker `mode` is set at creation from the workspace `environmentMode` (`AddBrokerModal.tsx` — `useWorkspaceStore((s) => s.environmentMode)` passed as `mode` to both `testBrokerCredentials` and `registerBrokerAccount`). There is no mode-edit path afterward.
- Add flow: `channels.accounts.addBroker` handler in `electron/main/ipc/workspace/accounts.ts` → `brokerAccountAddSchema` (`src/lib/schemas.ts`, credentials are `z.record(z.string())` — blanks legal) → `serializeBrokerCredentials` → `brokerRegistry.buildEphemeral` → `adapter.testConnection()` gate → `secrets.set(secretRef, json)` + `brokerAccounts.insert`.
- `brokerAccounts.secretRef` column is `notNull` (`db/schema.ts`) — a seeded row must still carry a `secretRef` string even though no secret is stored under it.
- Session env scoping: `services/session/environment-scope.ts` filters brokers by workspace paper/live mode.

---

## Part 1 — Implementation spec

Execute in order. After each step run its acceptance checks. Run `bun run lint` and the named test files as you go; full gate at the end.

### Step 1 — Adapter: tolerate absent credentials

**File:** `electron/main/services/broker/adapters/polymarket-adapter.ts`

1. Make the credential fields optional:

```ts
type PolymarketCredentials = {
  privateKey?: string;
  funderAddress?: string;
  host?: string;
  chainId?: number;
};
```

2. In `createAuthedClient()`, make the reads blank-safe (the guard that follows already throws the right structured error):

```ts
const privateKey = (this.credentials.privateKey ?? "").trim();
const funderAddress = (this.credentials.funderAddress ?? "").trim();
```

Nothing else in the adapter reads `privateKey`/`funderAddress` (verified: `host`/`chainId` reads already use `?? default`). Do not touch the paper paths.

3. Update `scripts/prove-trade-loop.ts` `provePolymarket()`: replace the dummy `credentials` object (`privateKey: "0x0123…", funderAddress: "0x…0001"`) with `{}` and pass that to both `PolymarketAdapter` constructions (initial + the rebuild that simulates restart). This makes the proof script itself the regression test that paper mode is credential-free.

**Tests** (extend `electron/main/services/broker/adapters/__tests__/polymarket-adapter.test.ts`, follow its existing mocking style):
- Paper adapter constructed with `{}`: `testConnection()` ok; a marketable ghost order fills; `getAccountBalance()` returns the paper balance.
- Live adapter constructed with `{}`: the first authed-path call rejects with `AppError` code `BROKER_ERROR` mentioning "private key and funder address" — and does **not** TypeError.

**Acceptance:** `bun test polymarket-adapter` green; `bun run prove -- --mode=polymarket` passes end-to-end with no credentials in the script.

### Step 2 — Registry: build seeded credential-less accounts

**File:** `electron/main/services/broker/broker-registry.ts`

1. In `get()`, the missing-secret throw currently reads:

```ts
if (!secret && account.brokerType !== "mock") {
  throw new AppError(...MISSING_SECRET...);
}
```

Change the condition so paper Polymarket is also exempt:

```ts
const credentialFreePaper =
  account.brokerType === "polymarket" && account.mode === "paper";
if (!secret && account.brokerType !== "mock" && !credentialFreePaper) {
  throw new AppError(...unchanged...);
}
```

The existing `secret ?? "{}"` fallback on the `buildAdapter` call already feeds `{}` downstream — keep it.

2. In `buildAdapter()`'s `case "polymarket"`, change the `requireJsonParse` generic to the now-optional shape so the types tell the truth:

```ts
const parsed = requireJsonParse<{
  privateKey?: string;
  funderAddress?: string;
  host?: string;
  chainId?: number;
}>(credsJson, undefined, "Invalid Polymarket credentials JSON");
```

Constructor call stays as-is (Step 1 made the fields optional).

**Tests** (registry test file if one exists, else add to the adapter test): a `brokerType: "polymarket", mode: "paper"` account whose `secretRef` has **no stored secret** builds via `get()` without `MISSING_SECRET`, and its `testConnection()` reaches the paper path. A `mode: "live"` Polymarket account with no secret must still throw `MISSING_SECRET` — assert that too.

**Acceptance:** targeted tests green; no other adapter case behavior changed (`bun test broker-registry` or the enclosing suite).

### Step 3 — Add-Broker UI: say it out loud

**File:** `src/components/accounts/AddBrokerModal.tsx`

1. `AddBrokerModal` already reads `environmentMode` from `useWorkspaceStore`. Pass it into `CredentialFields` as a new `mode: "paper" | "live"` prop.
2. In `CredentialFields`, change the `brokerType === "polymarket"` block: when `mode === "paper"`, render **no inputs** — just the standard hint style used by the Kalshi/Tradier blocks (`mt-1 text-caption text-text3`):

> Paper (hover) mode — no credentials required. Orders fill locally against live
> Polymarket prices; balance is virtual. Add credentials later by re-adding the
> account in Live mode.

When `mode === "live"`, keep the two existing fields unchanged.
3. `credentials()` needs no change — for paper Polymarket it returns `{ privateKey: "", funderAddress: "" }` and `serializeBrokerCredentials` already tolerates that. Test/Save flow is untouched: paper `testConnection` exercises public reachability, which is exactly what the hover account depends on.

**Verification (mandatory, per the visual-work rules):** run the app, open Settings → Brokers → Add broker with the workspace in Paper mode, select Polymarket, screenshot (`scripts/snap.sh` if the app is web-reachable, else an Electron screenshot), **look at it**, and confirm: no key fields, hint present, Test → Save round-trip creates the account, and the account then appears in `list_brokers` output / the brokers list with a $1,000 balance. This also confirms the "blank fields already work" hypothesis from the TLDR — if Test or Save fails here, stop and diagnose before proceeding; do not paper over it.

### Step 4 — Seed `seed-polymarket-paper`

**File:** `electron/main/db/seed.ts`

1. Add alongside the existing seeded-ID constants:

```ts
export const SEEDED_POLYMARKET_BROKER_ID = "seed-polymarket-paper";
export const SEEDED_POLYMARKET_SECRET_REF = "broker:seed-polymarket-paper";
```

2. In `runSeed`, insert the row **unconditionally except under vitest** (mirror the Alpaca seed's `env.isTest` guard — test suites assert empty-broker paths):

```ts
if (!env.isTest) {
  db.insert(schema.brokerAccounts)
    .values({
      id: SEEDED_POLYMARKET_BROKER_ID,
      name: "Polymarket Hover (Seeded)",
      brokerType: "polymarket",
      supportedInstrumentClasses: JSON.stringify(["prediction_market"]),
      mode: "paper",
      maxSessions: 4,
      allocationEnforcement: "hard",
      balanceRefreshIntervalMin: 5,
      balanceCacheUsd: null,
      balanceCachedAt: null,
      mockScenarioKind: null,
      mockExecutionTier: null,
      secretRef: SEEDED_POLYMARKET_SECRET_REF, // column is notNull; no secret is ever stored under this ref — Step 2 makes that legal
      updatedAt: new Date().toISOString(),
    })
    .onConflictDoNothing()
    .run();
}
```

No secret write. No env gating (this is the point — unlike Alpaca/OpenRouter there is nothing secret to gate on).

**Tests:** a seed test (pattern: existing seed/`experience-catalog-seeds` tests) asserting the row exists after `runSeed` with `env.isTest` forced false, and that `BrokerRegistry.get(SEEDED_POLYMARKET_BROKER_ID)` returns an adapter (network calls mocked).

**Acceptance:** fresh dev DB (delete/relocate the local dev SQLite, launch app) shows "Polymarket Hover (Seeded)" in Settings → Brokers, connection test passes, and a `prediction-event-edge` session can be created against it and started (it validates against the `polymarket_broker` requirement in `SessionWriteService.validate`).

### Step 5 — Surface resolved-vs-marked outcomes (small, do last)

The adapter's settle result already distinguishes `resolved: true` (settled at the real gamma 0/1 outcome) from mark-to-market closes. Carry that flag through wherever trade close/P&L details are persisted and rendered (start from `get_trade_detail` in `services/control/capabilities-reads.ts` and the trade-detail UI) so a hover account's P&L can be read as "realized against actual outcomes" vs "marked". If the plumbing turns out to touch more than the trade-detail read path and one UI surface, stop and report scope before continuing — this step is optional polish, not a license to refactor trade persistence.

### Final gate

- `bun run lint` clean; full `bun test` (or the project's standard suite command) green — no skips.
- `bun run prove -- --mode=polymarket` passes with credential-less construction.
- Manual journey from "User journey" above executed and screenshotted.
- Then and only then: overwrite `docs/prompts/setup-everything.md` with the contents of `docs/prompts/setup-everything-v2.md`, delete the v2 file, and update `docs/plans/index.md` to mark this TODO done.

| Step | Work | Est. |
|---|---|---|
| 1 | Adapter optional creds + prove script | ~½ day incl. tests |
| 2 | Registry missing-secret exemption | ~1–2 h |
| 3 | UI hint + visual verification | ~2–3 h |
| 4 | Seed + fresh-DB check | ~2 h |
| 5 | Resolved-vs-marked P&L surfacing | ~½–1 day, optional |

---

## Part 2 — `setup-everything.md` audit (what the v2 prompt fixes)

Findings ordered by severity, kept for the record; every fix is already baked into `docs/prompts/setup-everything-v2.md`.

**P0 — Polymarket branch structurally dead.** The prompt (lines 132–141) says: find a paper Polymarket broker or mark the branch blocked, and never invent one. With no seeded account, no broker-creation tool, and a UI that demands a real Polygon private key even for paper, the branch is unreachable on a fresh install by design. *v2 fix:* the branch now targets `seed-polymarket-paper` by ID, with a fallback instruction that names the credential-free Settings flow.

**P0 — Env-gated seeds never stated.** `seed-alpaca-paper` exists only if `ALPACA_API_KEY` + `ALPACA_SECRET_KEY` were set at seed time; `seed-openrouter` needs `OPEN_ROUTER_KEY` + `OPEN_ROUTER_MODEL` (`seed.ts`, `config/env.ts`). Missing env ⇒ every branch dies at Phase 1 and the "stress test" degenerates into a readiness report. *v2 fix:* explicit host-prerequisites section naming the four env vars plus `EXVA_LOG_LEVEL=debug`, and an instruction to verify the seeds exist before proposing any matrix.

**P1 — "Using the seeded X input profile" is not a choice the operator can make.** `create_session`'s schema (`sessionCreateInputSchema`, `electron/shared/validation/schemas.ts`) has no profile/subscription parameter. The default profile is auto-provisioned by experience on create (`SessionWriteService.create` → `provisionDefaultInputs` hook), and **provisioning failure is a non-fatal WARN** ("Default input provisioning failed") leaving the session silently signal-less. *v2 fix:* phrased as "create with experience X, then verify the expected subscription via `get_session_status`", with the WARN event named as a per-session launch gate.

**P1 — Phase 1 item 4 not executable.** No provider-inventory read tool exists (only `get_provider_health` + dashboard reads; verified across `capabilities*.ts`). *v2 fix:* item softened to what the tools can actually answer, with an explicit "report as not inspectable" instruction. (Alternative: add a `list_providers` read tool — worth doing eventually, not required for the prompt to be executable.)

**P2 — "If the catalog marks it disabled" has no referent.** `ExperienceDescriptor` has no disabled/launchable flag. Options-flow's real gate is its Tradier `placeSpread` dependency and no Tradier account is ever seeded. *v2 fix:* reworded to name the Tradier dependency.

**Verified fine (no change needed):** all six `docs/engineering/*` files; `EXVA_LOG_LEVEL` (`config/env.ts`); `bun run prove -- --mode=polymarket` (`package.json`); every named control tool including `pause_session`/`resume_session`; `maxSessions: 10` on the Alpaca seed vs the 6–8 matrix; Alpaca seed's `stock/crypto/options` classes covering the major-crypto breakout session; the workspace paper/live environment concept (`environment-scope.ts`).
