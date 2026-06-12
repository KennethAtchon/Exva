# Phase 1 — Enum & Type Overhaul

> **Date:** 2026-05-28
> **Status:** Todo
> **Spec sections:** §6.3.1, §6.3.2
> **Depends on:** Phase 0 (DB migration — `processing_mode` column must exist)
> **Unlocks:** Phase 2 (Signal Infrastructure), Phase 5 (Sources UI)

---

## 1. Problem Statement

The domain enum types in `shared/domain/enums.ts` (and matching preset JSON files) are built around a day-trading mental model: trend scans, chart breakouts, intraday timeframes, RSI/MACD momentum. None of this applies to signal-driven catalyst trading. The enums must be replaced; the old values will be removed without compatibility shims.

---

## 2. Goals

| #   | Goal                                                             | Done When                                                                             |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | `ResearchDiscoveryMode` replaced with `ProcessingMode`           | Old type gone, new type has `catalyst \| contract \| manual`                          |
| 2   | `ResearchEvidenceMode` simplified                                | 3 values only: `document_first \| balanced \| probability_edge`                       |
| 3   | `SetupType` simplified                                           | 4 values: `catalyst_entry \| event_entry \| probability_edge \| custom`               |
| 4   | `StrategyEntryStyle` simplified                                  | 3 values: `catalyst \| event \| probability_edge`                                     |
| 5   | `HoldingStyle` drops `intraday_flat`                             | 3 values remain                                                                       |
| 6   | `TradingTimeframe` drops sub-hourly bars                         | `30m \| 1h \| 4h \| 1d \| 1w`                                                         |
| 7   | `ResearchPosturePresetId` replaced                               | 4 named presets + `custom`                                                            |
| 8   | `TradeRulesPresetId` simplified                                  | 4 values                                                                              |
| 9   | `TimeframePresetId` replaces `intraday` with `catalyst`          |                                                                                       |
| 10  | All `discoveryMode` field references renamed to `processingMode` | Zero instances of old name remain                                                     |
| 11  | Preset JSON files fully replaced                                 | `research-posture.json`, `trade-rules.json`, `timeframe.json`, `global-strategy.json` |
| 12  | TypeScript compilation passes with zero type errors              |                                                                                       |

---

## 3. Type Changes

### 3.1 `ResearchDiscoveryMode` → `ProcessingMode`

File: `electron/shared/domain/enums.ts` (confirm path)

```typescript
// REMOVE
export type ResearchDiscoveryMode =
  | "trend_scan"
  | "catalyst_scan"
  | "quality_watchlist"
  | "mean_reversion_scan"
  | "event_contract_scan"
  | "custom";

// ADD
export type ProcessingMode = "catalyst" | "contract" | "manual";
```

**Find all usages:**

```bash
grep -r "ResearchDiscoveryMode\|discoveryMode\|discovery_mode" electron/shared electron/main src --include="*.ts" --include="*.tsx" -l
```

Every file found must be updated. No exceptions. No optional-chain hacks around removed fields.

### 3.2 `ResearchEvidenceMode`

```typescript
// REMOVE: "narrative_first" | "price_action_first" | "confirmation_first" | "probability_edge" | "balanced"

// REPLACE WITH
export type ResearchEvidenceMode =
  | "document_first" // renamed from narrative_first
  | "balanced"
  | "probability_edge";
```

### 3.3 `SetupType`

```typescript
// REMOVE: "breakout" | "pullback_trend" | "reversal_fade"
// KEEP/ADD
export type SetupType =
  | "catalyst_entry"
  | "event_entry"
  | "probability_edge"
  | "custom";
```

### 3.4 `StrategyEntryStyle`

```typescript
// REMOVE: "breakout" | "pullback" | "reversal" | "range_fade"
export type StrategyEntryStyle = "catalyst" | "event" | "probability_edge";
```

### 3.5 `HoldingStyle`

```typescript
// REMOVE: "intraday_flat"
export type HoldingStyle = "multi_day_swing" | "weeks_position" | "custom";
```

### 3.6 `TradingTimeframe`

```typescript
// REMOVE: "1m" | "5m" | "15m"
export type TradingTimeframe = "30m" | "1h" | "4h" | "1d" | "1w";
```

### 3.7 `ResearchPosturePresetId`

```typescript
// REMOVE: "trend_hunt" | "catalyst_momentum" | "institutional_quality" | "mean_reversion_dislocation"
export type ResearchPosturePresetId =
  | "edgar_catalyst"
  | "earnings_event"
  | "prediction_event_edge"
  | "manual_watchlist"
  | "custom";
```

### 3.8 `TradeRulesPresetId`

```typescript
// REMOVE: "breakout_long" | "pullback_trend" | "reversal_fade"
export type TradeRulesPresetId =
  | "catalyst_entry"
  | "event_entry"
  | "probability_edge"
  | "custom";
```

### 3.9 `TimeframePresetId`

```typescript
// REMOVE: "intraday"
// ADD: "catalyst"
export type TimeframePresetId =
  | "catalyst"
  | "swing"
  | "position"
  | "prediction"
  | "custom";
```

---

## 4. Field Rename: `discoveryMode` → `processingMode`

Everywhere `discoveryMode` is used as a field name (TypeScript interfaces, Drizzle schema column mappings, IPC request/response types, UI form state, strategy config forms), rename it to `processingMode`.

The DB column rename is handled in Phase 0. Here we rename the TypeScript-layer field references.

Key locations to audit:

- `ResearchPosture` interface / type definition
- Session research posture repository (read/write mapping)
- IPC handler for session update
- Strategy Config form component (`StrategyConfig.tsx` or equivalent)
- Any `switch (discoveryMode)` or `if (discoveryMode ===` logic

---

## 5. Preset JSON File Replacements

### 5.1 `research-posture.json`

Replace entire file. Keep only:

| ID                      | Label                   | processingMode | evidenceMode       | catalystMode | fundamentalStrictness |
| ----------------------- | ----------------------- | -------------- | ------------------ | ------------ | --------------------- |
| `edgar_catalyst`        | "EDGAR Catalyst"        | `catalyst`     | `document_first`   | `required`   | `balanced`            |
| `earnings_event`        | "Earnings Event"        | `catalyst`     | `balanced`         | `required`   | `sanity_check`        |
| `prediction_event_edge` | "Prediction Event Edge" | `contract`     | `probability_edge` | `required`   | `not_applicable`      |
| `manual_watchlist`      | "Manual Watchlist"      | `manual`       | `balanced`         | `preferred`  | `sanity_check`        |
| `custom`                | "Custom Style"          | `manual`       | `balanced`         | `preferred`  | `balanced`            |

### 5.2 `trade-rules.json`

Replace entire file. Keep only:

| ID                 | Label              | setupType          | sideBias | entryStyle         | exitStyle           | scaling        |
| ------------------ | ------------------ | ------------------ | -------- | ------------------ | ------------------- | -------------- |
| `catalyst_entry`   | "Catalyst Entry"   | `catalyst_entry`   | `both`   | `catalyst`         | `thesis_based`      | `single_entry` |
| `event_entry`      | "Event Entry"      | `event_entry`      | `both`   | `event`            | `time_based`        | `single_entry` |
| `probability_edge` | "Probability Edge" | `probability_edge` | `both`   | `probability_edge` | `market_resolution` | `single_entry` |
| `custom`           | "Custom Rules"     | `custom`           | `both`   | `catalyst`         | `fixed_pct`         | `single_entry` |

### 5.3 `timeframe.json`

Remove `intraday` preset. Add:

```json
{
  "id": "catalyst",
  "label": "Catalyst",
  "description": "Daily bars, 1–5 day hold. Fast reaction window for EDGAR and event-driven catalysts.",
  "values": {
    "primaryTradingTimeframe": "1d",
    "holdingStyle": "multi_day_swing",
    "targetHoldDays": 2,
    "maxHoldDays": 5
  }
}
```

### 5.4 `global-strategy.json`

Remove: `trend_momentum`, `catalyst_play`, `quality_value`, `mean_reversion`.

Add:

| ID                 | Label              | posturePreset           | rulesPreset        | riskPreset          | timeframePreset |
| ------------------ | ------------------ | ----------------------- | ------------------ | ------------------- | --------------- |
| `edgar_catalyst`   | "EDGAR Catalyst"   | `edgar_catalyst`        | `catalyst_entry`   | `moderate`          | `catalyst`      |
| `earnings_event`   | "Earnings Event"   | `earnings_event`        | `event_entry`      | `moderate`          | `catalyst`      |
| `prediction_edge`  | "Prediction Edge"  | `prediction_event_edge` | `probability_edge` | `prediction_market` | `prediction`    |
| `manual_watchlist` | "Manual Watchlist" | `manual_watchlist`      | `catalyst_entry`   | `moderate`          | `swing`         |

---

## 6. Ripple Effects to Audit

After type changes, run TypeScript compiler and address every error before considering this phase done.

Known areas that will break:

- Any `switch` on `ResearchDiscoveryMode` or `discoveryMode` values
- UI dropdowns hardcoded with old enum string values
- Strategy Config form validation rules referencing removed values
- Seeded preset data in DB (if preset IDs are seeded, update seed scripts)
- Tests that assert on old enum values

---

## 7. Checklist

- [ ] All 9 enum types updated in `enums.ts`
- [ ] Zero references to `ResearchDiscoveryMode` remain
- [ ] Zero references to `discoveryMode` remain (field name)
- [ ] Zero references to removed enum values (`trend_scan`, `breakout`, `pullback`, `intraday_flat`, `1m`, `5m`, `15m`, `intraday`, `trend_hunt`, `breakout_long`, etc.)
- [ ] `research-posture.json` replaced
- [ ] `trade-rules.json` replaced
- [ ] `timeframe.json` updated (intraday removed, catalyst added)
- [ ] `global-strategy.json` replaced
- [ ] `tsc --noEmit` passes with zero errors
- [ ] Strategy Config UI dropdowns render only valid new values
