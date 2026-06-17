# Experience / Signal Model Redesign — Deep Plan

> **Date:** 2026-06-15
> **Status:** Draft
> **Owner:** Kenneth
> **Audience:** Engineers, reviewers, future maintainers
> **Scope:** The domain modeling of _Experiences_, _Signals/Signal Sources_, _Strategies_, and _Pipelines_ — descriptors, schema, session bootstrap, source provisioning, and the docs that describe AI-vs-deterministic behavior. Does **not** cover the runtime SignalBus, EDGAR polling, or pipeline worker internals except where the model touches them.
> **Related:** [`signal-driven-architecture.md`](./signal-driven-architecture.md) (established global signal sources + `session_signal_sources` join), [`ai-control-center.md`](./ai-control-center.md)

---

> **Architecture Principle — No Backward Compatibility (Destructive Changes Encouraged)**
>
> There are no real users, sessions, or data to preserve. Backward compatibility is **explicitly not a goal** — and destructive changes are **actively encouraged** wherever they produce a cleaner result. When existing code conflicts with this design, **delete it and rewrite it**; do not preserve it.
>
> Concretely, for this work it is correct and expected to:
>
> - **Delete** the `rules-qqq-mean-reversion/` and `btc-momentum-breakout/` descriptor directories outright (not deprecate, not alias).
> - **Remove** the singular `signalSource` field from `ExperienceDescriptor` entirely — no optional shim, no dual-read.
> - **Rename/replace** functions and ids freely (`ensureExperienceSignalSource` → `ensureExperienceSignalSources`, `resolvePipelineIdForSource` → `resolvePipelineIdForExperience`) without keeping the old names.
> - **Edit `schema.ts` in place** and recreate the SQLite DB from `schema.ts` + `seed.ts`. No data migration, no backfill, no `ALTER`-with-fallback. Drop and reseed.
> - **Drop** any data-migration helper that exists only to translate old shapes (e.g. `migrate-mock-rehearsal-subscriptions` if it no longer fits) rather than adapting it.
>
> Forbidden: compatibility shims, migration adapters, optional chaining around removed fields, "legacy" code paths, or feature flags that keep the old model alive. A clean codebase beats a compatible one. If a section must be gutted to fit, gut it.

---

## 1. Executive Summary

Today an "Experience" in Exva is a single, fully-specified trading config masquerading as a category. The `ExperienceDescriptor` type carries a **singular** `signalSource`, and the four rules experiences encode a specific instrument, poll cadence, and strategy directly in their `displayName` — "SPY 15m mean reversion", "QQQ 15m mean reversion", "BTC-USD 1h momentum breakout", "GC/CL 4h trend following". The UI then renders each of these as an experience whose sub-items are a "Listener" and a "Timer", which is confusing because the experience _is_ the signal. There is nothing left for a signal source to do that the experience didn't already decide.

This is the wrong mental model. An Experience should be a **tent**: a general theme that groups many concrete signals the operator can toggle on simultaneously within one session. The concrete `(instrument × timeframe × strategy × source)` tuple should be a **Signal**, not an Experience. This redesign promotes `ExperienceDescriptor.signalSource: SignalSource` (one) to `ExperienceDescriptor.signals: SignalDescriptor[]` (many), moves instrument/symbol/cadence/timeframe down onto each `SignalDescriptor`, **keeps the pipeline at the experience level** (one pipeline per experience — the pipeline _is_ the strategy that defines the tent), and reconciles the descriptor layer with the already-existing many-to-many `session_signal_sources` join table that the signal-driven-architecture spec introduced but the descriptors never used.

The redesign is difficult for three reasons. First, the 1:1 assumption is wired into multiple layers — `sessions.experienceId` (single column), `ensureExperienceSignalSource` (provisions exactly one source per experience), `loadExperiencePresetBundle` (one preset bundle per experience), and `experience-launchability` (one capability set per experience). Second, the codebase **conflates timer poll cadence with analysis timeframe**: every rules experience sets `timeframePresetId: "swing"` while advertising "15m"/"1h"/"4h" in its name — those numbers are the timer gap (`signalSource.defaultConfig.cadence`), not the trading timeframe. Third, there is at least one outright correctness bug riding on the confusion: **"BTC-USD 1h momentum breakout" runs `RULES_MEAN_REVERSION_PIPELINE`** (a deterministic, `phases: ["decision"]`, zero-LLM mean-reversion plan), so the name lies about what the system does.

The rest of this document establishes the current state precisely, defines the target tent/signal model, gives an exact descriptor + schema + bootstrap design, sequences a migration that leaves the registry valid after each phase, and specifies how docs and the type system will make "is this pipeline AI-driven or deterministic?" a first-class, non-guessable fact.

---

## 2. Problem Statement

**What hurts today.**

1. **Experiences are over-specified.** `RULES_MEAN_REVERSION_EXPERIENCE` (`electron/main/experiences/rules-mean-reversion/descriptor.ts`) hardcodes `displayName: "SPY 15m mean reversion (rules)"`, `signalSource.defaultConfig = { symbol: "SPY", cadence: "15m", instrumentClass: "stock" }`. To trade QQQ on the same logic, a _separate experience_ (`rules-qqq-mean-reversion`) exists that is byte-for-byte identical except `displayName`, `symbol`, and `instrumentClass`. This does not scale: every `(symbol, cadence)` pair becomes a new top-level experience.

2. **One experience = one signal, so the signal layer is vestigial.** `ensureExperienceSignalSource` (`electron/main/experiences/ensure-experience-signal-sources.ts`) creates exactly one `signal_sources` row per experience, named after the experience's `displayName`. The operator cannot toggle multiple signals inside one experience because the experience only owns one. The `session_signal_sources` join table — designed for many-to-many in `signal-driven-architecture.md` — is fed a 1:1 relationship.

3. **Cadence is mislabeled as timeframe.** All four rules experiences set `presets.timeframePresetId: "swing"`. The "15m / 1h / 4h" in their names is the timer poll interval in `signalSource.defaultConfig.cadence`. Nothing in the model defines the _analysis timeframe_ of a signal distinctly from how often its timer fires. The operator's literal question — _"is 15m the time between or the timeframe?"_ — cannot be answered from the data because the model never separated them.

4. **A pipeline correctness bug hides in the noise.** `BTC_MOMENTUM_BREAKOUT_EXPERIENCE` references `RULES_MEAN_REVERSION_PIPELINE` (`electron/main/experiences/btc-momentum-breakout/descriptor.ts:21`). That pipeline is deterministic mean-reversion (`pipelines.ts:42-50`). "Momentum breakout" is not what runs. There is no trend/breakout rules pipeline distinct from mean-reversion wired to BTC at all.

5. **AI-vs-deterministic is implicit.** `PipelineDescriptor` (`pipeline-descriptor-store.ts`) has `phases`, `signalSources`, `phaseWorkers`, `plan` — but **no field stating whether the pipeline calls an LLM**. The only signal of "deterministic" is a code comment (`pipelines.ts:40-41`) and the empirical fact that `phaseWorkers` is `{ decision: [] }`. Docs cannot reliably convey "this path is autonomous/deterministic vs agent-driven" because the source of truth is a comment.

**Who is affected.** The operator (confusing UX, can't compose signals), and any engineer extending the system (must clone an entire experience to add a symbol; can't tell which pipelines are AI-driven without reading worker sets).

**Risk if nothing changes.** The experience list grows linearly with `(symbol × cadence × strategy)` combinations; the BTC mislabel-class of bug recurs every time a name and a pipeline drift; and documentation of autonomy guarantees stays unverifiable.

**Why now.** The signal-driven architecture already shipped the join table and global sources. The descriptor layer is the last place still asserting 1:1. Fixing it now, before more experiences are cloned, is cheap; later it is N rewrites.

---

## 3. Goals, Non-Goals, and Invariants

### Goals

| #   | Goal                                               | Success Looks Like                                                                                                                                                                                         |
| --- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | Experience becomes a general grouping ("tent")     | An experience declares 0..N signals; adding a symbol does not require a new experience                                                                                                                     |
| G2  | Concrete trading triggers become Signals           | `(instrumentClass, symbol, pollCadence, analysisTimeframe, sourceType)` lives on a `SignalDescriptor`, not an experience name; the pipeline stays one-per-experience                                       |
| G3  | Many signals toggleable per session simultaneously | Session creation lets the operator enable/disable each of an experience's signals; enabled set persists to `session_signal_sources`                                                                        |
| G4  | Timeframe separated from cadence                   | `SignalDescriptor` has both `pollCadence` (timer gap) and `analysisTimeframe` (strategy horizon); they are never the same field                                                                            |
| G5  | Pipeline automation is explicit                    | `PipelineDescriptor.automation: "deterministic" \| "ai" \| "hybrid"`, validated against `phaseWorkers`, surfaced in UI + docs                                                                              |
| G6  | Discovered bugs fixed                              | BTC routes to a real trend/breakout pipeline (or is renamed to match mean-reversion); the cadence/timeframe naming is corrected; duplicate identical experiences collapse into one tent + multiple signals |
| G7  | Docs state per-pipeline whether AI or auto         | Each experience/pipeline doc page renders an "Automation: Deterministic / AI" badge sourced from `automation`, not prose                                                                                   |
| G8  | Pipeline steps are listable per experience         | `describePipelineSteps(experience)` returns ordered stages/engines (from `pipeline.plan.inspect` + `phaseWorkers`) for UI + docs; rules experiences show their deterministic decision + risk-gate steps    |

### Non-Goals

| #   | Non-Goal                                                                | Why It Is Out Of Scope                                                                                                                                                                           |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| N1  | Per-session per-signal config overrides (custom cadence, custom symbol) | Inherits the deferral from `signal-driven-architecture.md`; signals are still descriptor-defined here                                                                                            |
| N2  | New SignalBus / runtime delivery semantics                              | This is a modeling change; FIFO queue, TTL, deliveries are unchanged                                                                                                                             |
| N3  | A user-defined "build your own signal" UI                               | Signals remain code-declared descriptors in this iteration                                                                                                                                       |
| N4  | Reworking strategy (AI guidance) authoring                              | `session_strategies` / strategy prompt context stay as-is except for the timeframe clarification                                                                                                 |
| N5  | Rewriting _existing_ pipeline worker internals                          | Existing pipelines change only in metadata. **Exception (D1):** one net-new deterministic `rules-breakout` engine + `rules-breakout-cycle` is built, mirroring the existing trend cycle's shape. |

### Invariants

| #   | Invariant                                                                                      | Why It Must Hold                                                                                                                    |
| --- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| I1  | Every Signal's `sourceType` is in its **experience's** `pipeline.signalSources`                | The experience owns the pipeline; routing is by experience, so every signal feeding it must be a source type that pipeline accepts  |
| I2  | A Pipeline's `automation` must be consistent with its `phaseWorkers`                           | `"deterministic"` ⇒ all phase worker lists empty / no LLM workers; `"ai"` ⇒ at least one LLM worker; checked at registry validation |
| I3  | An experience's `capabilities.signalSourceTypes` ⊇ the set of `sourceType` across its signals  | Existing `validateExperienceRegistry` invariant, generalized from one source to many                                                |
| I4  | `analysisTimeframe` and `pollCadence` are distinct fields and may differ                       | Resolves the operator's core confusion; prevents re-conflation                                                                      |
| I5  | A signal's `displayName` must not be the only place its instrument/cadence is encoded          | Names are derived from structured fields, so a name can never lie about behavior (prevents the BTC-class bug)                       |
| I6  | After each migration phase, `validateExperienceRegistry()` + `validatePipelineRegistry()` pass | Registry validation gates app boot; a broken phase = unbootable app                                                                 |

---

## 4. Current State

### 4.1 Architecture / components

The experience layer lives in `electron/main/experiences/`:

```text
electron/main/experiences/
  index.ts                          # registry: registerExperience / listExperiences / requireExperience / validateExperienceRegistry
  types.ts                          # ExperienceDescriptor interface
  session-bootstrap.ts              # loadExperiencePresetBundle — one preset bundle per experience
  ensure-experience-signal-sources.ts  # provisions ONE signal_sources row per experience (1:1)
  validate-source-capabilities.ts   # validateExperienceSourceEmissions
  rules-mean-reversion/descriptor.ts        # "SPY 15m mean reversion (rules)"
  rules-qqq-mean-reversion/descriptor.ts    # "QQQ 15m mean reversion (rules)"  (clone)
  btc-momentum-breakout/descriptor.ts       # "BTC-USD 1h momentum breakout (rules)" — BUG: mean-reversion pipeline
  commodities-trend-following/descriptor.ts # "GC/CL 4h trend following (rules)"
  edgar-catalyst/descriptor.ts
  prediction-event-edge/descriptor.ts
```

The shared domain types live in `electron/shared/domain/`:

- `experience.ts` — `ExperienceCapabilities` (`instrumentClasses`, `signalSourceTypes`, `brokerRequirement`, `defaultInstrumentClass`).
- `signals.ts` — `SignalSourceType` union, `SignalSourceRecord`, `SignalEvent`, `SessionSignalDelivery`, helper predicates (`isSelfDescribingSignalSourceType`, etc.).
- `signal-source-capabilities.ts` — `SIGNAL_SOURCE_CAPABILITIES` (which instrument classes a source type emits).

The pipeline layer: `electron/main/services/pipeline/implementations/registry/`:

- `pipeline-descriptor-store.ts` — `PipelineDescriptor` interface + registry validation.
- `pipelines.ts` — the five concrete descriptors.
- `pipeline-router.ts` — `resolvePipelineIdForSource(sourceType)`.

### 4.2 Data / state model

`ExperienceDescriptor` (current, `types.ts`):

```ts
export interface ExperienceDescriptor {
  id: string;
  displayName: string; // bakes instrument+cadence+strategy
  capabilities: ExperienceCapabilities;
  signalSource: {
    // SINGULAR — the core problem
    type: SignalSourceType;
    defaultConfig: Record<string, unknown>; // { symbol, cadence, instrumentClass }
  };
  pipeline: PipelineDescriptor; // SINGULAR
  presets: {
    posturePresetId: string;
    rulesPresetId: string;
    riskPresetId: string;
    timeframePresetId: string; // "swing" for ALL rules experiences
  };
  promptVariantKey: ProcessingMode;
  mockFixtures: { defaultScenario; scriptedWorkerOutputs };
}
```

`PipelineDescriptor` (current, `pipeline-descriptor-store.ts`):

```ts
export interface PipelineDescriptor {
  id: string;
  displayName: string;
  phases: readonly PipelinePhase[];
  signalSources: readonly SignalSourceType[];
  isDefault?: boolean;
  plan: InstrumentAnalysis<InstrumentAnalysisState>;
  phaseWorkers: Partial<Record<PipelinePhase, readonly string[]>>;
  selectorWorkerIds?: readonly string[];
  // NO `automation` field — AI-ness is implied by phaseWorkers being empty.
}
```

Relevant schema (`electron/main/db/schema.ts`):

- `sessions.experienceId text NOT NULL DEFAULT 'edgar-catalyst'` (line 67) — **one experience per session**.
- `signal_sources` (line 80): `id, type, name, description, enabled, configJson, …` — no `experienceId`, no typed cadence/timeframe; everything specific lives in `configJson`.
- `session_signal_sources` (line 174): `(sessionId, sourceId)` PK — **many-to-many already exists**, currently fed 1:1.
- `session_timeframe_config` (line 386): `timeframePresetId DEFAULT 'custom'`, `primaryTradingTimeframe`, `timeframeNotes` — the _analysis_ timeframe lives at the session level, derived from the experience's `timeframePresetId` preset.

### 4.3 Critical runtime flows

**Bootstrap / provisioning.** On startup, `ensureAllExperienceSignalSources(sourcesRepo)` iterates `listExperiences()` and calls `ensureExperienceSignalSource` for each, creating one `signal_sources` row whose `id = experienceSignalSourceId(experienceId)`, `type = experience.signalSource.type`, `configJson = JSON.stringify(experience.signalSource.defaultConfig)`. **One source, named after the experience.**

**Session creation.** A session picks an `experienceId`. `loadExperiencePresetBundle(client, experienceId)` reads the four preset rows referenced by `experience.presets` and returns the bundle. `resolveSessionInstrumentClasses(capabilities, …)` derives the instrument classes from the experience capabilities and broker overlap.

**Signal → pipeline.** When a source emits a `SignalEvent`, `resolvePipelineIdForSource(sourceType)` finds the pipeline whose `signalSources` includes the type. For `timer`, both `RULES_MEAN_REVERSION_PIPELINE` and `RULES_TREND_FOLLOWING_PIPELINE` declare `signalSources: ["timer"]` — meaning **routing by source type alone is ambiguous for timer signals**; the experience descriptor's explicit `pipeline` field is what actually disambiguates today. The target design keeps the pipeline on the experience and routes by experience (§9.8), making this ambiguity structurally impossible rather than relying on a hidden tiebreaker.

### 4.4 Observed pain points and root causes

| Pain                                         | Root Cause                                                                                          | Evidence                                                        |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Experience list explodes per symbol          | `displayName` + singular `signalSource` encode one instrument                                       | `rules-mean-reversion` vs `rules-qqq-mean-reversion` are clones |
| Can't toggle multiple signals in a session   | `ensureExperienceSignalSource` is 1:1                                                               | `ensure-experience-signal-sources.ts:6-23`                      |
| "15m" ambiguous                              | cadence (timer gap) ≠ timeframe, but only cadence is set distinctly; timeframe is `"swing"` for all | all four rules descriptors                                      |
| Name lies about behavior                     | No invariant tying name → pipeline; pipeline chosen by hand                                         | `btc-momentum-breakout/descriptor.ts:21` → mean-reversion       |
| Can't tell AI vs auto                        | No `automation` field on pipeline                                                                   | `pipeline-descriptor-store.ts`                                  |
| `timer` routing ambiguous                    | Two pipelines claim `signalSources: ["timer"]`                                                      | `pipelines.ts:46,69`                                            |
| `extractSignalInstrumentClass` inconsistency | capability says `mock = "from_config"` but fallback hardcodes `mock → "stock"`                      | `signal-source-capabilities.ts:22,39`                           |

---

## 5. Desired End State

### 5.1 Concepts (target vocabulary)

- **Experience (the tent).** A general trading _theme_: a display name like "Rules: Mean Reversion", a description, a capability envelope, default presets, and a **list of offered Signals**. It owns no single instrument. It answers "what _kind_ of trading is this?"
- **Signal (the concrete trigger).** A code-declared `SignalDescriptor`: `(sourceType, instrumentClass, symbol, pollCadence, analysisTimeframe, enabledByDefault, presetOverrides?, mockFixtures)`. It answers "trade _what_, _how often is it checked_, _on what horizon_." It does **not** carry a pipeline — the experience does. Many signals belong to one experience.
- **Strategy.** Unchanged: AI-trading guidance attached to a session (`session_strategies`, strategy prompt context). The redesign only clarifies that a session's _analysis timeframe_ is now sourced from the **enabled signals**, not from a single experience preset.
- **Pipeline.** The processor that defines a tent's strategy — **one per experience**. Plus an explicit `automation` classification and listable steps. Routing is by the session's experience, not by signal `sourceType` (which cannot distinguish mean-reversion from trend, since both consume `timer`).

### 5.2 Target descriptor shapes

```ts
// electron/shared/domain/signal-descriptor.ts (new)
export interface SignalDescriptor {
  id: string; // "spy-15m-meanrev"  (stable, used as signal_sources.id seed)
  displayName: string; // DERIVED helper available; stored for label only
  sourceType: SignalSourceType; // "timer" | "edgar_8k" | ...
  instrumentClass: InstrumentClass;
  symbol: string | null; // null for self-describing sources (edgar)
  pollCadence: string | null; // "15m" — timer gap; null for event-driven sources
  defaultAnalysisTimeframe: TradingTimeframe; // D4: reuse existing vocab; seeds the session timeframe config (D2) — DISTINCT from pollCadence
  // NOTE: no pipelineId — the pipeline lives on the experience (one per tent).
  enabledByDefault: boolean; // pre-checked in session creation
  presetOverrides?: Partial<ExperiencePresetIds>; // optional per-signal preset tweaks
  mockFixtures: {
    defaultScenario: MockScenarioKind;
    scriptedWorkerOutputs: ScriptedWorkerOutputs;
  };
}

// electron/main/experiences/types.ts (revised)
export interface ExperienceDescriptor {
  id: string;
  displayName: string; // GENERAL: "Rules: Mean Reversion"
  description: string; // new — the tent's elevator pitch
  capabilities: ExperienceCapabilities; // instrumentClasses/signalSourceTypes = UNION across signals
  pipelineId: string; // ONE pipeline per experience — the strategy that defines the tent
  signals: SignalDescriptor[]; // was `signalSource`; now many
  defaultPresets: ExperiencePresetIds; // tent-level defaults; signals may override
  promptVariantKey: ProcessingMode;
}
```

```ts
// PipelineDescriptor (revised)
export type PipelineAutomation = "deterministic" | "ai" | "hybrid";
export interface PipelineDescriptor {
  id: string;
  displayName: string;
  automation: PipelineAutomation; // NEW — source of truth for "AI or auto?"
  phases: readonly PipelinePhase[];
  signalSources: readonly SignalSourceType[];
  isDefault?: boolean;
  plan: InstrumentAnalysis<InstrumentAnalysisState>;
  phaseWorkers: Partial<Record<PipelinePhase, readonly string[]>>;
  selectorWorkerIds?: readonly string[];
}
```

### 5.3 Target experience registry

The six descriptors collapse/clarify into tents:

| Tent (experience)                                | Signals (toggleable)                   | Pipeline (experience-level)   | Automation    |
| ------------------------------------------------ | -------------------------------------- | ----------------------------- | ------------- |
| `rules-mean-reversion` "Rules: Mean Reversion"   | `spy-15m`, `qqq-15m` (+future symbols) | `rules-mean-reversion-cycle`  | deterministic |
| `rules-trend-following` "Rules: Trend Following" | `gc-4h`, `cl-4h` (+future symbols)     | `rules-trend-following-cycle` | deterministic |
| `rules-breakout` "Rules: Momentum Breakout"      | `btc-1h` (+future symbols)             | `rules-breakout-cycle` (NEW)  | deterministic |
| `edgar-catalyst` "EDGAR Catalyst"                | `edgar-8k`                             | `edgar-8k-cycle`              | ai            |
| `prediction-event-edge` "Prediction Event Edge"  | `prediction-event`                     | `prediction-event-cycle`      | ai            |

Notes:

- `rules-qqq-mean-reversion` as a _separate experience_ is **deleted**; QQQ becomes a signal under `rules-mean-reversion`.
- `commodities-trend-following` is **deleted** and folded into a generic `rules-trend-following` tent (D3); GC/CL become `gc-4h` / `cl-4h` signals.
- `btc-momentum-breakout` as a separate experience is **deleted**. Per **D1**, BTC moves into a **new `rules-breakout` tent** backed by a **new `rules-breakout-cycle` pipeline + `rules-breakout` policy engine** — breakout is a distinct strategy, and no breakout engine exists today (the old experience wrongly ran mean-reversion). The deterministic breakout decision logic is net-new work (see §9.4, Phase 3).

### 5.4 Session ↔ signal relationship

A session still picks **one experience** (`sessions.experienceId` survives as the tent pointer). On creation, the experience's signals are listed with `enabledByDefault` checkboxes; the enabled set is provisioned into `signal_sources` (if not already present) and linked via `session_signal_sources`.

**Timeframe (D2).** The session's analysis timeframe is **owned by the session strategy / timeframe config** that already exists (`session_timeframe_config.primaryTradingTimeframe`, `session_strategies.primaryTradingTimeframe`), not by the signal. Each signal carries a `defaultAnalysisTimeframe` that **seeds** the session timeframe config when the operator hasn't set one; thereafter the session config governs at runtime. Signals thus depend on the session strategy config — an accepted dependency. Because the timeframe is a single session-level value, there is no "mixed timeframe across signals" conflict to resolve.

### 5.5 What gets deleted / changed / added

- **Deleted:** `rules-qqq-mean-reversion/`, `btc-momentum-breakout/` descriptor dirs; singular `signalSource` field. `ExperienceDescriptor.pipeline` stays (as `pipelineId`) — only the singular `signalSource` is replaced by `signals[]`.
- **Changed:** `types.ts`, `experience.ts` capabilities derivation, `ensure-experience-signal-sources.ts` (1→N provisioning), `session-bootstrap.ts` (presets become tent-default + per-signal override merge), `index.ts` validation, `pipelines.ts` (+`automation`), `pipeline-descriptor-store.ts` (+field +validation), `signal-source-capabilities.ts` (fix mock inconsistency).
- **Added:** `electron/shared/domain/signal-descriptor.ts`, a `signalDisplayName(signal)` deriver, `automation`-based docs badge, optional `signal_sources.experienceId` + typed columns (see §6).

---

## 6. Gap Analysis

| Area                     | Current State                                | Target State                                                                           | Required Change                               |
| ------------------------ | -------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------- |
| Experience → signal      | `signalSource` singular                      | `signals: SignalDescriptor[]`                                                          | New type; rewrite 6 descriptors → 4 tents     |
| Pipeline reference       | On experience (singular `pipeline`)          | Stays on experience (`pipelineId`); route by experience, not `sourceType`              | Keep field; switch router to experience-based |
| Provisioning             | 1 source/experience                          | N sources/experience                                                                   | Rewrite `ensure-experience-signal-sources.ts` |
| Capabilities             | Hand-set per experience                      | Derived union over signals                                                             | Compute in validation/bootstrap               |
| Cadence vs timeframe     | Conflated (cadence set, timeframe="swing")   | Two distinct fields                                                                    | Add `pollCadence` + `analysisTimeframe`       |
| Pipeline automation      | Implicit (comment)                           | Explicit `automation` field                                                            | Add field + registry invariant + UI/docs      |
| Naming integrity         | `displayName` hand-typed, can lie            | Derived from structured fields                                                         | `signalDisplayName()` helper; lint/test       |
| BTC routing              | mean-reversion pipeline                      | trend (or new breakout) pipeline                                                       | Re-point + verify                             |
| `session_signal_sources` | Fed 1:1                                      | Fed 1:N                                                                                | Session-create writes enabled set             |
| `signal_sources` schema  | Everything in `configJson`                   | Typed `experienceId`, `instrumentClass`, `pollCadence`, `analysisTimeframe` (optional) | Schema add (no-back-compat: edit `schema.ts`) |
| mock instrument class    | capability `from_config` vs fallback `stock` | Consistent                                                                             | Fix `extractSignalInstrumentClass`            |

**Hard gaps in prose.**

The deepest coupling is _routing by `sourceType`_. Because two pipelines both claim `signalSources: ["timer"]`, the source type alone cannot route; today the experience's singular `pipeline` field silently disambiguates. The fix is to make that explicit: **the experience owns the pipeline, and routing is by experience.** A `timer` signal under the "Rules: Mean Reversion" tent runs the mean-reversion cycle; the identical `sourceType` under "Rules: Trend Following" runs the trend cycle — disambiguated by tent, not source. `resolvePipelineIdForSource(sourceType)` is replaced by `resolvePipelineIdForExperience(experienceId)`. This is the load-bearing change; everything else is mechanical. (Putting the pipeline on the signal instead was rejected — a coherent tent is _defined_ by one strategy/pipeline; a signal needing a different pipeline belongs in a different tent.)

The second gap is _capability derivation_. `ExperienceCapabilities.instrumentClasses` / `signalSourceTypes` are hand-maintained today. With many signals they must be the **union** over the experience's signals, or they will drift. Compute them (or validate them == the union) at registry time.

The third is _timeframe semantics at the session level_. `session_timeframe_config` is single-valued, sourced from one experience preset. Per **D2**, this stays single-valued and **authoritative**: each enabled signal's `defaultAnalysisTimeframe` only _seeds_ it; the session strategy/timeframe config governs at runtime. Signals therefore depend on the session strategy config (accepted), and there is no multi-signal timeframe conflict.

---

## 7. Options Considered

### Option A: Tent + Signal descriptor redesign (recommended)

Promote `signalSource` → `signals[]`, move cadence + timeframe onto `SignalDescriptor`, keep one pipeline per experience, derive capabilities, add `automation` + step-listing. Experiences become themes; sessions toggle signals into the existing join table.

| Dimension        | Assessment                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| Build complexity | Medium — descriptor + provisioning + validation rewrite, contained to `experiences/` + pipeline registry |
| Migration risk   | Low — no real data; registry validated at boot                                                           |
| Runtime risk     | Low-medium — pipeline routing change is the sharp edge                                                   |
| Reversibility    | High — descriptors are code; revert is a git revert                                                      |
| Team fit         | High — matches the already-shipped many-to-many join table                                               |
| Testability      | High — registry validation + descriptor unit tests already exist                                         |
| Maintainability  | High — adding a symbol = add a `SignalDescriptor` entry                                                  |

### Option B: Keep experiences 1:1, fix only naming + BTC bug

Rename "SPY 15m mean reversion" → clearer text, fix BTC pipeline, document cadence vs timeframe in prose. No structural change.

| Dimension        | Assessment                                                             |
| ---------------- | ---------------------------------------------------------------------- |
| Build complexity | Low                                                                    |
| Migration risk   | Very low                                                               |
| Runtime risk     | Very low                                                               |
| Reversibility    | High                                                                   |
| Team fit         | Poor — leaves the join table feeding 1:1, perpetuates clone-per-symbol |
| Testability      | High                                                                   |
| Maintainability  | Low — the explosion problem remains                                    |

Rejected: it treats symptoms. The operator explicitly wants many toggleable signals per experience; this delivers none of that.

### Option C: Fully data-driven, operator-authored signals (UI builder)

Make signals first-class DB rows the operator creates/edits in the UI, experiences as user-defined folders. Maximum flexibility.

| Dimension        | Assessment                                                   |
| ---------------- | ------------------------------------------------------------ |
| Build complexity | High — CRUD UI, validation, config schema per source type    |
| Migration risk   | Medium                                                       |
| Runtime risk     | Medium — user input drives routing                           |
| Reversibility    | Medium                                                       |
| Team fit         | Premature — no demand yet for arbitrary user-defined signals |
| Testability      | Medium                                                       |
| Maintainability  | Medium — more surface area                                   |

Rejected for this iteration (matches Non-Goal N3). Option A is the foundation Option C would later build on.

---

## 8. Recommendation

**Adopt Option A.** It is the smallest change that makes the model match reality: experiences are themes, signals are concrete triggers, and the many-to-many join table the project already built is finally fed correctly. It directly delivers the operator's stated want — "an experience [that] has many signals and u can toggle them all on at the same time."

It beats the status quo because the status quo forces a new top-level experience for every `(symbol, cadence)` and lets names drift from behavior (the BTC bug). It beats Option B because B leaves the structural defect — the explosion and the vestigial signal layer — in place. It beats Option C because C builds an operator-authoring surface no one has asked for, on top of a model that does not yet exist; A _is_ that model, and C can follow later.

**Assumptions the recommendation depends on:** (a) no real user data to migrate (stated project principle); (b) a dedicated breakout pipeline/engine is built for BTC (D1); (c) the session strategy/timeframe config is the single authority for analysis timeframe, seeded by signals (D2). **What would change it:** if operator-authored signals become an immediate requirement, jump to Option C's data model rather than hardcoding descriptors.

---

## 9. Detailed Design

### 9.1 File layout

```text
electron/shared/domain/
  signal-descriptor.ts        # NEW: SignalDescriptor, ExperiencePresetIds, signalDisplayName() (uses TradingTimeframe from enums.ts)
  experience.ts               # ExperienceCapabilities unchanged shape; doc note: classes are the union
  signals.ts                  # SignalSourceType unchanged
  signal-source-capabilities.ts  # FIX mock inconsistency

electron/main/experiences/
  types.ts                    # ExperienceDescriptor: signals[], description, defaultPresets, no pipeline/signalSource
  index.ts                    # registry validation generalized to many signals
  session-bootstrap.ts        # preset bundle = defaultPresets ⊕ per-signal overrides
  ensure-experience-signal-sources.ts  # 1→N provisioning, ids from signal.id
  rules-mean-reversion/descriptor.ts   # tent with signals: [spy-15m, qqq-15m]
  rules-trend-following/descriptor.ts  # tent with signals: [gc-4h, cl-4h, btc-1h]  (renamed dir)
  edgar-catalyst/descriptor.ts
  prediction-event-edge/descriptor.ts
  rules-breakout/descriptor.ts  # NEW (D1): BTC momentum breakout tent
  # DELETED: rules-qqq-mean-reversion/ (→ signal), commodities-trend-following/ (→ trend tent), btc-momentum-breakout/ (→ breakout tent)

electron/main/services/pipeline/implementations/registry/
  pipeline-descriptor-store.ts  # +automation field, +validateAutomation invariant
  pipelines.ts                  # +automation on all; +rules-breakout-cycle (D1)
  ../rules/breakout-analysis.ts # NEW (D1): RULES_BREAKOUT_CYCLE + rules-breakout policy engine
  pipeline-router.ts            # resolve by experience.pipelineId (not by sourceType)
```

### 9.2 `SignalDescriptor` and derivation

```ts
// D4: reuse the existing timeframe vocabulary — no new enum.
import type { TradingTimeframe } from "@electron/shared/domain/enums";
// TradingTimeframe = "15m" | "30m" | "1h" | "4h" | "1d" | "1w"

export interface ExperiencePresetIds {
  posturePresetId: string;
  rulesPresetId: string;
  riskPresetId: string;
  timeframePresetId: string;
}

export interface SignalDescriptor {
  id: string;
  sourceType: SignalSourceType;
  instrumentClass: InstrumentClass;
  symbol: string | null;
  pollCadence: string | null; // timer gap; null when event-driven
  defaultAnalysisTimeframe: TradingTimeframe; // D2/D4: seeds the SESSION timeframe config; session config is authoritative at runtime
  // no pipelineId — pipeline is experience-level
  enabledByDefault: boolean;
  presetOverrides?: Partial<ExperiencePresetIds>;
  mockFixtures: {
    defaultScenario: MockScenarioKind;
    scriptedWorkerOutputs: ScriptedWorkerOutputs;
  };
}

/** Names are DERIVED so they cannot lie about behavior (Invariant I5). */
export function signalDisplayName(s: SignalDescriptor): string {
  const sym = s.symbol ?? sourceTypeLabel(s.sourceType);
  const cadence = s.pollCadence ? ` · every ${s.pollCadence}` : "";
  return `${sym} · ${s.defaultAnalysisTimeframe} TF${cadence}`;
  // e.g. "SPY · 1h TF · every 15m"  — analysis timeframe (1h chart) and poll cadence (every 15m) both visible, distinct
}
```

### 9.3 Example tent descriptor (replaces two clones)

```ts
export const RULES_MEAN_REVERSION_EXPERIENCE: ExperienceDescriptor = {
  id: "rules-mean-reversion",
  displayName: "Rules: Mean Reversion",
  description:
    "Deterministic mean-reversion entries on timer-polled liquid instruments. No LLM calls.",
  capabilities: {
    instrumentClasses: ["stock"], // == union over signals (validated)
    signalSourceTypes: ["timer"],
    brokerRequirement: "any_supported_class",
    defaultInstrumentClass: "stock",
  },
  pipelineId: "rules-mean-reversion-cycle", // ONE pipeline for the whole tent
  defaultPresets: {
    posturePresetId: "manual_watchlist",
    rulesPresetId: "catalyst_entry",
    riskPresetId: "moderate",
    timeframePresetId: "swing", // a real TimeframePresetId; seeds session_timeframe_config
  },
  promptVariantKey: "manual",
  signals: [
    {
      id: "spy-15m-meanrev",
      sourceType: "timer",
      instrumentClass: "stock",
      symbol: "SPY",
      pollCadence: "15m", // timer fires every 15m
      defaultAnalysisTimeframe: "1h", // seeds session timeframe; distinct from cadence
      enabledByDefault: true,
      mockFixtures: {
        defaultScenario: "clean_breakout",
        scriptedWorkerOutputs: {},
      },
    },
    {
      id: "qqq-15m-meanrev",
      sourceType: "timer",
      instrumentClass: "stock",
      symbol: "QQQ",
      pollCadence: "15m",
      defaultAnalysisTimeframe: "1h",
      enabledByDefault: true,
      mockFixtures: {
        defaultScenario: "clean_breakout",
        scriptedWorkerOutputs: {},
      },
    },
  ],
};
```

### 9.4 Pipeline automation field + invariant

```ts
// pipelines.ts
export const RULES_MEAN_REVERSION_PIPELINE: PipelineDescriptor = {
  id: "rules-mean-reversion-cycle",
  displayName: "Rules mean reversion",
  automation: "deterministic", // explicit; was only a comment
  phases: ["decision"],
  signalSources: ["timer"],
  plan: RULES_MEAN_REVERSION_CYCLE,
  phaseWorkers: { decision: [] },
};
export const EDGAR_8K_PIPELINE: PipelineDescriptor = {
  id: "edgar-8k-cycle",
  displayName: "EDGAR 8-K (self-describing)",
  automation: "ai",
  phases: ["fundamental", "review", "decision"],
  signalSources: ["edgar_8k", "mock"],
  plan: EDGAR_8K_TRADE_CYCLE,
  phaseWorkers: PIPELINE_WORKER_SETS.catalystTwoCall,
  selectorWorkerIds: [],
};

// D1: NEW deterministic breakout pipeline. Mirrors the trend cycle's two-step
// shape (decision → risk_gate) but binds a NEW `rules-breakout` policy engine
// whose breakout decision logic must be implemented in breakout-analysis.ts.
export const RULES_BREAKOUT_PIPELINE: PipelineDescriptor = {
  id: "rules-breakout-cycle",
  displayName: "Rules momentum breakout",
  automation: "deterministic",
  phases: ["decision"],
  signalSources: ["timer"],
  plan: RULES_BREAKOUT_CYCLE,
  phaseWorkers: { decision: [] },
};
```

Registry validation (Invariant I2) in `validatePipelineDescriptor`:

```ts
const hasWorkers =
  Object.values(d.phaseWorkers).some((ws) => (ws?.length ?? 0) > 0) ||
  (d.selectorWorkerIds?.length ?? 0) > 0;
if (d.automation === "deterministic" && hasWorkers)
  throw new Error(
    `Pipeline '${d.id}' marked deterministic but declares phase workers.`,
  );
if (d.automation === "ai" && !hasWorkers)
  throw new Error(`Pipeline '${d.id}' marked ai but declares no workers.`);
```

### 9.5 Provisioning (1 → N) + boot reconcile (D5)

```ts
export function ensureExperienceSignalSources(
  sourcesRepo: SignalSourcesRepo,
  experienceId: string,
): SignalSourceRecord[] {
  const experience = requireExperience(experienceId);
  return experience.signals.map((signal) => {
    const sourceId = signalSourceId(experienceId, signal.id);
    const existing = sourcesRepo.get(sourceId);
    if (existing) return existing;
    return sourcesRepo.create({
      id: sourceId,
      type: signal.sourceType,
      name: signalDisplayName(signal),
      description: `${experience.displayName} signal`,
      enabled: true,
      experienceId,
      instrumentClass: signal.instrumentClass,
      pollCadence: signal.pollCadence,
      analysisTimeframe: signal.defaultAnalysisTimeframe, // typed column (default; session config governs)
      pipelineId: experience.pipelineId, // denormalized from the experience
      configJson: JSON.stringify({
        signalId: signal.id,
        symbol: signal.symbol,
      }),
    });
  });
}

/**
 * D5: after provisioning, delete experience-owned sources that no longer
 * correspond to any descriptor signal. Safe — no real data, no-back-compat.
 */
export function reconcileExperienceSignalSources(
  sourcesRepo: SignalSourcesRepo,
): void {
  const liveIds = new Set(
    listExperiences().flatMap((e) =>
      e.signals.map((s) => signalSourceId(e.id, s.id)),
    ),
  );
  for (const src of sourcesRepo.listExperienceOwned()) {
    if (!liveIds.has(src.id)) sourcesRepo.delete(src.id); // cascades to session_signal_sources
  }
}
```

`sourcesRepo.listExperienceOwned()` returns rows where `experienceId IS NOT NULL` (ad-hoc / user sources are never pruned). Both functions run at boot, after the registries validate.

### 9.6 Registry validation generalized (`index.ts`)

For each experience: require ≥1 signal; `experience.pipelineId` resolves via `requirePipelineDescriptor`; `capabilities.signalSourceTypes` == union of `signals[].sourceType`; `capabilities.instrumentClasses` ⊇ union of `signals[].instrumentClass`; **every `signal.sourceType` is in `experience.pipeline.signalSources`** (Invariant I1) — i.e. the tent's pipeline can actually process each of its signals. Replaces the current single-`signalSource` checks at `index.ts:34-62`.

### 9.7 Schema changes

Add typed columns to `signal_sources` (edit `schema.ts` directly per no-back-compat) so signals are queryable without parsing `configJson`:

```ts
export const signalSources = sqliteTable("signal_sources", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  experienceId: text("experience_id"), // NEW (nullable: ad-hoc sources have none)
  instrumentClass: text("instrument_class"), // NEW
  pollCadence: text("poll_cadence"), // NEW — timer gap
  analysisTimeframe: text("analysis_timeframe"), // NEW — strategy horizon
  pipelineId: text("pipeline_id"), // NEW — denormalized from the owning experience
  configJson: text("config_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
```

`sessions.experienceId` is **kept** (the tent pointer). `session_signal_sources` is unchanged — it now carries the operator's enabled set. `session_timeframe_config` is unchanged structurally and remains authoritative; it is _seeded_ from enabled signals' `defaultAnalysisTimeframe` (D2).

### 9.8 Router change

`resolvePipelineIdForSource(sourceType)` is replaced by `resolvePipelineIdForExperience(experienceId)`, which returns `requireExperience(experienceId).pipelineId`. Routing is by the session's experience, not by signal `sourceType`. This removes the timer ambiguity (mean-reversion vs trend) structurally: the two pipelines are never both candidates for one signal, because the signal's experience already names exactly one pipeline. The provisioned `signal_sources.pipelineId` column (denormalized from the experience) lets runtime resolve the pipeline from a `SignalSourceRecord` without a second experience lookup.

### 9.9 Listing pipeline steps for an experience

The operator (and docs) need to see _what an experience actually does_ — its ordered steps and whether each calls an LLM. The steps are **not** in `phaseWorkers` alone; the real execution order lives in the cycle plan (`pipeline.plan.inspect`: `stageIds`, `phaseStages`, `engineStages`) merged with `phaseWorkers` (the LLM workers per phase). Expose one deriver:

```ts
// pipeline-descriptor-store.ts (or a sibling)
export interface PipelineStep {
  id: string; // "rules_decision" | "risk_gate" | ...
  phase: PipelinePhase; // "decision" | "fundamental" | ...
  kind: "deterministic" | "llm"; // llm iff phaseWorkers[phase] is non-empty
  engines: readonly string[]; // engine ids from plan.inspect.engineStages
  workers: readonly string[]; // LLM worker ids from phaseWorkers[phase]
}

export function describePipelineSteps(p: PipelineDescriptor): PipelineStep[] {
  return p.plan.inspect.stageIds.map((id) => {
    const phase = stagePhase(p.plan, id); // from plan.inspect.phaseStages mapping
    const workers = p.phaseWorkers[phase] ?? [];
    return {
      id,
      phase,
      kind: workers.length > 0 ? "llm" : "deterministic",
      engines: enginesForStage(p.plan, id),
      workers,
    };
  });
}

// convenience for the experience layer
export function describeExperienceSteps(experienceId: string): PipelineStep[] {
  return describePipelineSteps(
    requirePipelineDescriptor(requireExperience(experienceId).pipelineId),
  );
}
```

**Steps for the two rule experiences** (both `automation: "deterministic"`, identical shape — derived from `RULES_MEAN_REVERSION_CYCLE` / `RULES_TREND_FOLLOWING_CYCLE` in `electron/main/services/pipeline/implementations/rules/`):

| Order | Step (`id`)                              | Phase       | Kind                     | Engines                                                       | LLM? |
| ----- | ---------------------------------------- | ----------- | ------------------------ | ------------------------------------------------------------- | ---- |
| 1     | `rules_decision`                         | `decision`  | deterministic policy     | `rules-mean-reversion` (or `rules-trend-following`)           | no   |
| 2     | `risk_gate` (skipped if step 1 = `skip`) | `risk_gate` | execution + policy chain | `trade-execution-profile` → `risk-gate` → `broker-allocation` | no   |

So a rules experience is exactly **two steps, zero LLM calls**: a deterministic entry decision, then a risk/execution gate. Compare an AI experience like EDGAR Catalyst, whose `phaseWorkers` populate `fundamental`/`review` phases with LLM workers (`PIPELINE_WORKER_SETS.catalystTwoCall`) before the decision — `describePipelineSteps` marks those steps `kind: "llm"`.

### 9.10 Docs / automation badge

Each experience + pipeline doc page renders an **Automation** badge from `PipelineDescriptor.automation` (`Deterministic` / `AI` / `Hybrid`) **and** the step list from `describeExperienceSteps`. Generate the experience catalog doc from the registry (a small script reading `listExperiences()` + `describeExperienceSteps`), so docs never drift from descriptors. Deterministic pipelines render "No LLM calls — fully autonomous" plus their step table; `ai`/`hybrid` flag which steps invoke the model.

---

## 10. Migration / Implementation Plan

Each phase leaves the registry valid (Invariant I6: `validateExperienceRegistry()` + `validatePipelineRegistry()` pass) and the app bootable. Per the principle above, each phase **deletes and replaces** the old shape rather than layering on top — there is no dual-write/dual-read or backfill period anywhere in this plan, and "rollback" means `git revert` + drop/reseed the local DB, not a data un-migration.

### Phase 1 — Pipeline automation field

- **Objective:** Make AI-vs-deterministic explicit before touching experiences.
- **Code:** Add `automation` to `PipelineDescriptor`; set it on all five pipelines; add the I2 invariant to `validatePipelineDescriptor`.
- **Schema:** none.
- **Validation:** `validatePipelineRegistry()` passes; new unit test asserts each pipeline's `automation` matches its worker set.
- **Rollback:** revert; field is additive.
- **Done:** all pipelines carry `automation`; deterministic/ai mismatch throws at boot.

### Phase 2 — `SignalDescriptor` type + derivation helpers

- **Objective:** Introduce the new domain type with no behavior change yet.
- **Code:** Add `electron/shared/domain/signal-descriptor.ts` (`SignalDescriptor`, `ExperiencePresetIds`, `signalDisplayName`, `sourceTypeLabel`; `defaultAnalysisTimeframe` typed with the existing `TradingTimeframe` — D4, no new enum). No descriptor consumes it yet.
- **Validation:** unit tests for `signalDisplayName` (shows cadence and timeframe distinctly).
- **Rollback:** delete file.
- **Done:** type compiles; helpers tested.

### Phase 3 — Convert `ExperienceDescriptor` to `signals[]`

- **Objective:** The load-bearing change.
- **Code:**
  - Rewrite `types.ts` (replace singular `signalSource` with `signals: SignalDescriptor[]`; add `description`, `defaultPresets`; keep `pipelineId` as the experience-level pipeline).
  - **Build the breakout pipeline (D1):** add `rules/breakout-analysis.ts` (`RULES_BREAKOUT_CYCLE` + `rules-breakout` policy engine + `rules-breakout-input` builder, mirroring the trend cycle's `decision → risk_gate` shape) and register `RULES_BREAKOUT_PIPELINE`. The breakout decision logic is net-new — it does not exist today.
  - Rewrite descriptors as tents: `rules-mean-reversion` (SPY, QQQ); `rules-trend-following` (GC, CL); **new** `rules-breakout` (BTC). **Delete** `rules-qqq-mean-reversion/`, `btc-momentum-breakout/`, and `commodities-trend-following/` (folded into `rules-trend-following/`). Each tent sets its one `pipelineId`; BTC lives under `rules-breakout` → `rules-breakout-cycle`, so its name finally matches its behavior.
  - Generalize `validateExperienceRegistry` (§9.6); switch the router to `resolvePipelineIdForExperience`.
- **Schema:** none yet (descriptors only).
- **Validation:** `validateExperienceRegistry()` passes; existing `experience-descriptors.test.ts` updated to assert: ≥1 signal each, capability union correctness, `experience.pipelineId` resolves, **every `signal.sourceType` ∈ `experience.pipeline.signalSources`**, and the BTC-class regression (Invariant I5; see §11).
- **Rollback:** git revert of `experiences/`.
- **Done:** five tents registered (mean-reversion, trend-following, breakout, edgar-catalyst, prediction-event-edge); BTC runs `rules-breakout-cycle` by virtue of its tent; QQQ is a signal not an experience.

### Phase 4 — Provisioning 1 → N + schema columns

- **Objective:** Provision a source per signal; make signals queryable.
- **Code:** Rewrite `ensure-experience-signal-sources.ts` (§9.5) including the D5 `reconcileExperienceSignalSources` prune; update `experienceSignalSourceId` → `signalSourceId(experienceId, signalId)`; update `session-bootstrap.ts` preset merge (`defaultPresets ⊕ signal.presetOverrides`).
- **Schema:** add `experienceId`, `instrumentClass`, `pollCadence`, `analysisTimeframe`, `pipelineId` to `signal_sources` (edit `schema.ts`); regenerate Drizzle; reseed (no data to preserve).
- **Validation:** boot provisions N sources per tent; D5 prune deletes a source removed from a descriptor; `migrate-mock-rehearsal-subscriptions` + `ensure-*-signal-source` tests updated; assert `session_signal_sources` can hold multiple rows for one session.
- **Rollback:** revert + reseed.
- **Done:** one tent yields multiple `signal_sources` rows; stale rows pruned; router resolves via `experience.pipelineId`.

### Phase 5 — Session creation toggles + timeframe derivation

- **Objective:** Operator can enable/disable each signal; session timeframe seeded from signals, owned by strategy config.
- **Code:** Session-create flow lists `experience.signals` with `enabledByDefault` checkboxes; writes enabled set to `session_signal_sources`. **Seed `session_timeframe_config.primaryTradingTimeframe` from the enabled signals' `defaultAnalysisTimeframe` (D2)** — the session strategy/timeframe config is authoritative thereafter; no "mixed" resolution needed. Update `resolveSessionInstrumentClasses` to use the union over _enabled_ signals' instrument classes.
- **Schema:** none (uses existing join + timeframe tables).
- **Validation:** e2e — create a `rules-mean-reversion` session, confirm SPY+QQQ both enabled and both deliver; disable QQQ, confirm only SPY delivers.
- **Rollback:** revert UI + session-create writer.
- **Done:** multiple signals toggle independently within one session.

### Phase 6 — Fix `extractSignalInstrumentClass` + docs generation

- **Objective:** Close the mock inconsistency and ship the automation docs.
- **Code:** In `signal-source-capabilities.ts`, drive `mock` instrument class from config (matching its `"from_config"` capability) instead of hardcoding `"stock"`. Add `describePipelineSteps` / `describeExperienceSteps` (§9.9) and the registry-driven experience/pipeline catalog doc + automation badge + step tables.
- **Validation:** `schemas.test.ts` / capability tests updated; unit test asserts rules experiences yield exactly the two deterministic steps; docs build shows correct badges + step lists.
- **Done:** capability and extractor agree; docs state automation and the ordered steps per experience.

---

## 11. Testing and Verification Strategy

- **Unit — `signalDisplayName`:** asserts cadence and timeframe both render and are distinct (e.g. `"SPY · intraday · every 15m"`), guarding Invariant I4.
- **Unit — pipeline automation invariant:** for each pipeline, `automation === "deterministic"` ⇒ no workers; `"ai"` ⇒ has workers (I2).
- **Unit — registry (`experience-descriptors.test.ts`):** each experience has ≥1 signal; `experience.pipelineId` resolves; `capabilities.signalSourceTypes` equals the union of `signals[].sourceType`; `instrumentClasses` ⊇ union; every `signal.sourceType` ∈ `experience.pipeline.signalSources` (I1, I3).
- **Unit — step listing (G8):** `describeExperienceSteps("rules-mean-reversion")` returns exactly `[rules_decision, risk_gate]`, both `kind: "deterministic"`; an AI experience returns ≥1 step with `kind: "llm"`.
- **Regression — name/behavior integrity (I5):** assert no experience whose id contains `trend`/`breakout` has `pipelineId === "rules-mean-reversion-cycle"`; explicit guard against the BTC-class bug (name ≠ pipeline) recurring.
- **Integration — provisioning:** booting provisions exactly `Σ signals` `signal_sources` rows; ids are stable across reboots (idempotent `ensure`).
- **Integration — capability/extractor agreement:** `extractSignalInstrumentClass` for a `mock` event returns the config-declared class, not a hardcoded `"stock"`.
- **E2E — multi-signal session:** create a `rules-mean-reversion` session with SPY+QQQ enabled; assert both produce deliveries; disable QQQ and re-run; assert only SPY.
- **Local commands:** `bun run typecheck`, `bun test electron/main/experiences`, `bun test electron/shared/domain`, `bun run test:e2e -- session-creation`.
- **Boot smoke:** app launches (registry validation gates boot — a failed invariant is a hard, visible failure, not a silent one).

---

## 12. Risks and Failure Modes

| #   | Risk                                                                    | Likelihood | Impact                     | Detection                                                     | Mitigation                                                                | Rollback                                 |
| --- | ----------------------------------------------------------------------- | ---------- | -------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------- |
| R1  | Timer routing ambiguous if an experience omits `pipelineId`             | Low        | High (wrong strategy runs) | Registry validation requires `experience.pipelineId`          | Make `pipelineId` required on `ExperienceDescriptor`; route by experience | revert Phase 3                           |
| R2  | New breakout decision logic is wrong/incomplete (net-new per D1)        | Medium     | Medium                     | Unit tests for `rules-breakout` engine; mock-rehearsal review | Spec breakout entry rules before coding; gate BTC behind tests            | revert breakout engine; disable `btc-1h` |
| R3  | ~~Session timeframe undefined when signals disagree~~ (resolved by D2)  | —          | —                          | n/a — session strategy config is single authority             | D2: signals seed, session config governs                                  | n/a                                      |
| R4  | Capability union hand-maintained drifts from signals                    | Medium     | Low                        | Registry validation computes/asserts union                    | Compute, don't hand-set                                                   | n/a (caught at boot)                     |
| R5  | Stale `signal_sources` rows after a signal is removed from a descriptor | Low        | Low                        | Boot reconcile diff (descriptor signals vs provisioned rows)  | `reconcileExperienceSignalSources` prune on boot (D5)                     | drop/reseed (no real data)               |
| R6  | UI assumes one signal per session somewhere downstream                  | Medium     | Medium                     | grep for `experienceSignalSourceId` single-source assumptions | Audit consumers in Phase 4/5                                              | revert UI phase                          |

**Top risks in practice.** R1 is largely _designed out_ by putting the pipeline on the experience: two `signalSources: ["timer"]` pipelines can never both be candidates for one signal, because the signal's experience names exactly one pipeline. The residual risk is an experience declaring no `pipelineId` — made impossible by the required field + registry validation (boot fails loudly). R2 is now the sharpest _code_ risk: per D1 the breakout decision logic is net-new and must be written and tested before `btc-1h` is enabled — until then BTC stays disabled rather than mislabeled.

---

## 13. Operational Rollout

Desktop Electron app, single local SQLite DB recreated from `schema.ts` + `seed.ts`; no servers, no staged environments. Rollout = land phases in order on a branch, each gated by `typecheck` + targeted tests + a boot smoke. Because registry validation runs at startup, an invariant violation fails loudly at launch rather than corrupting runtime — there is no silent-degradation path to monitor. No feature flag is required; the no-back-compat principle means each phase replaces the prior shape outright. Sequencing note: the breakout decision logic (D1) is net-new — if it is not ready when Phase 3 lands, register the `rules-breakout` tent but ship `btc-1h` with `enabledByDefault: false` so nothing mislabeled runs, then enable it once the engine is tested.

---

## 14. Resolved Decisions

All open questions are resolved (Kenneth, 2026-06-16).

| #   | Question                                                             | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | BTC "momentum breakout": dedicated pipeline or fold into trend?      | **Dedicated.** Momentum breakout is a genuinely distinct entry strategy from trend-following, and no breakout engine exists today (only `rules-mean-reversion` and `rules-trend-following`). Per the names-must-not-lie principle, create a `rules-breakout` tent + `rules-breakout-cycle` pipeline + `rules-breakout` policy engine. The deterministic breakout decision logic is **net-new** (the old experience wrongly ran mean-reversion). |
| D2  | Session timeframe when enabled signals differ on timeframe?          | **The session's strategy / timeframe config is authoritative** (`session_timeframe_config` + `session_strategies.primaryTradingTimeframe` already exist). A signal carries a `defaultAnalysisTimeframe` that _seeds_ the session config; at runtime the session config governs. Signals therefore depend on the session strategy config — accepted. This eliminates the "mixed timeframe" conflict (there is one session-level value).          |
| D3  | `commodities-trend-following`: own tent or merge into generic trend? | **Merge.** GC/CL become `gc-4h` / `cl-4h` signals under a generic `rules-trend-following` tent. The `commodities-trend-following/` directory is deleted.                                                                                                                                                                                                                                                                                        |
| D4  | New `TimeframeKey` enum vs reuse existing timeframe vocabulary?      | **Reuse.** Use the existing `TradingTimeframe` (`"15m" \| "30m" \| "1h" \| "4h" \| "1d" \| "1w"`, `electron/shared/domain/enums.ts`). No new `TimeframeKey` type. `defaultAnalysisTimeframe: TradingTimeframe`. (Note: this shares notation with `pollCadence` but is a distinct field — see I4.)                                                                                                                                               |
| D5  | Auto-prune stale `signal_sources` on boot?                           | **Yes.** Add a reconcile/prune step to `ensureExperienceSignalSources` (or a sibling) that deletes provisioned experience-owned sources no longer present in any descriptor. Safe given no-back-compat.                                                                                                                                                                                                                                         |

---

## 15. Appendix

### A. Code references (current state)

- `electron/main/experiences/types.ts` — `ExperienceDescriptor` (singular `signalSource`, `pipeline`).
- `electron/main/experiences/index.ts:29-72` — `validateExperienceRegistry`, registrations.
- `electron/main/experiences/ensure-experience-signal-sources.ts` — 1:1 provisioning.
- `electron/main/experiences/session-bootstrap.ts` — one preset bundle per experience.
- `electron/main/experiences/{rules-mean-reversion,rules-qqq-mean-reversion,btc-momentum-breakout,commodities-trend-following}/descriptor.ts` — the four rules experiences.
- `electron/main/services/pipeline/implementations/registry/pipelines.ts` — five pipelines; BTC bug at `btc-momentum-breakout/descriptor.ts:21`.
- `electron/main/services/pipeline/implementations/registry/pipeline-descriptor-store.ts` — `PipelineDescriptor` (no `automation`).
- `electron/shared/domain/signal-source-capabilities.ts:22,39` — mock `from_config` vs hardcoded `stock`.
- `electron/main/db/schema.ts` — `sessions.experienceId:67`, `signal_sources:80`, `session_signal_sources:174`, `session_timeframe_config:386`.

### B. Defect summary (folded from TODO)

1. **Over-specified experiences** — `(symbol, cadence, strategy)` baked into `displayName` + singular `signalSource`; clones per symbol.
2. **BTC mislabel** — `btc-momentum-breakout` runs deterministic `rules-mean-reversion-cycle`; name ≠ behavior.
3. **Cadence/timeframe conflation** — "15m/1h/4h" is timer gap; `timeframePresetId` is `"swing"` for all; no distinct `analysisTimeframe`.
4. **Vestigial signal layer** — `session_signal_sources` (many-to-many) fed 1:1 by `ensureExperienceSignalSource`.
5. **Implicit automation** — `PipelineDescriptor` has no `automation`; AI-vs-deterministic only knowable from a comment.
6. **Mock instrument-class inconsistency** — capability `"from_config"` contradicted by hardcoded `stock` fallback.
7. **Ambiguous timer routing** — two pipelines claim `signalSources: ["timer"]`; only the experience's hand-set `pipeline` disambiguates today.

### C. Terminology

- **Tent** — informal name for the generalized Experience: a theme grouping many signals.
- **Signal / SignalDescriptor** — concrete `(source, instrument, cadence, timeframe)` trigger; pipeline is owned by its experience, not the signal.
- **pollCadence** — how often a timer source fires (the "time between").
- **analysisTimeframe** — the trading horizon a strategy reasons over (the "timeframe").
- **automation** — `deterministic` (no LLM) | `ai` (LLM workers) | `hybrid`.
