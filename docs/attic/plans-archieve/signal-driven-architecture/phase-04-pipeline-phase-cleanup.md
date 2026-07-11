# Phase 4 — Pipeline Phase Cleanup

> **Date:** 2026-05-28
> **Status:** Todo
> **Spec sections:** §3 (worker add/remove list), §5.2 (catalyst pipeline flow)
> **Depends on:** Phase 3 (catalyst context must be injected into the selector cycle)
> **Unlocks:** Nothing (terminal phase for backend work)

---

## 1. Problem Statement

The pipeline currently has workers that belong to a chart-pattern / momentum day-trading model that is being removed. New workers are needed to support catalyst trading from EDGAR signals. The selector phase needs a `catalyst-feed-scout` that validates the signal and extracts structured data. The fundamental phase needs `document-extractor` (fetches the filing) and `market-reaction-checker`. The technical phase needs `price-reaction-checker` (replaces the removed TA workers).

---

## 2. Goals

| #   | Goal                                                          | Done When                                                              |
| --- | ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1   | Remove `chart-pattern` worker from technical phase            | No reference to it remains                                             |
| 2   | Remove `momentum-indicator` worker from technical phase       | No reference to it remains                                             |
| 3   | Remove `sentiment-context` worker from fundamental phase      | No reference to it remains                                             |
| 4   | Remove `trend-scout` worker from selector discovery           | No reference to it remains                                             |
| 5   | Add `price-reaction-checker` to catalyst technical workers    | Checks whether price has already moved >3% since filing                |
| 6   | Add `document-extractor` to catalyst fundamental workers      | Fetches and parses the 8-K filing document URL                         |
| 7   | Add `market-reaction-checker` to catalyst fundamental workers | Checks market reaction metrics since filing                            |
| 8   | Add `catalyst-feed-scout` to catalyst selector workers        | Validates the signal, extracts structured data, determines materiality |
| 9   | `processingMode = "catalyst"` routes to catalyst worker set   | Pipeline phase definitions route correctly                             |
| 10  | `processingMode = "trend_scan"` still routes web-search flow  | Backward compat for WebSearchSignalSource                              |

---

## 3. Workers to Remove

### 3.1 `chart-pattern` (technical phase)

**What it did:** Identified chart-based breakout/pullback setups from price history.
**Why removed:** EDGAR catalyst trading does not use chart-pattern TA signals. The pipeline decides based on filing materiality and price reaction, not chart structure.

**Cleanup steps:**

1. Find worker definition file (likely `electron/main/services/pipeline/workers/chart-pattern.ts` or similar).
2. Remove from technical phase definition config.
3. Delete the worker file.
4. Remove any tool registrations or engine bindings specific to this worker.
5. Remove any references in prompt files or context builders.

### 3.2 `momentum-indicator` (technical phase)

Same removal procedure as `chart-pattern`. Momentum indicators (RSI, MACD) are TA-derived and incompatible with the catalyst model.

### 3.3 `sentiment-context` (fundamental phase)

**What it did:** Aggregated social/news sentiment signals.
**Why removed:** Replaced by `document-extractor` (primary source = the filing itself, not aggregated sentiment).

### 3.4 `trend-scout` (selector discovery)

**What it did:** Found trending tickers via web search heuristics.
**Why removed:** Instrument discovery now comes from signal sources, not the selector phase.

---

## 4. Workers to Add

### 4.1 `catalyst-feed-scout` (selector phase, catalyst mode)

**Purpose:** Receives a pre-identified ticker + optional document URL from the catalyst context. Validates the ticker is a tradeable equity. Determines whether the 8-K filing is material and actionable (not administrative boilerplate).

**Inputs (from catalyst context in selectionInstructions):**

- Ticker symbol
- Company name
- Filing date
- Document URL (optional)
- `processingMode = "catalyst"`

**Outputs:**

- `isMaterial: boolean`
- `materialitySummary: string`
- `structuredCatalyst: { catalystType, magnitude, urgency }` (optional structured extraction)

**Drop condition:** If `isMaterial = false`, set delivery `drop_reason = "not_material"`, mark delivery `dropped`, skip remaining workers.

**Manual ticker behavior:** When source type is `manual`, skip document fetch. Validate ticker is a US equity via a market data lookup. If invalid, drop with `drop_reason = "invalid_ticker"`.

**Worker definition file:** `electron/main/services/pipeline/workers/selector/catalyst-feed-scout.ts`

**Phase config:** Add to selector phase under `processingMode === "catalyst"` condition.

---

### 4.2 `document-extractor` (fundamental phase, catalyst mode)

**Purpose:** Fetches the 8-K filing document from `documentUrl`, extracts key sections (Item 1.01, Item 2.02, etc.), and formats them for the downstream review phase.

**Inputs:** `documentUrl` from catalyst context.

**Tool used:** `fetch_url` (existing harness tool or a new `fetch_document` tool wrapping it with text extraction).

**Outputs:**

- `extractedText: string` — relevant filing sections
- `itemNumbers: string[]` — which 8-K items are present (e.g., `["1.01", "8.01"]`)
- `fetchError: string | null`

**Error handling:** On fetch error, pipeline continues with partial signal. `document-extractor` marks its output as incomplete. Review phase decides based on what it has.

**Worker definition file:** `electron/main/services/pipeline/workers/fundamental/document-extractor.ts`

---

### 4.3 `market-reaction-checker` (fundamental phase, catalyst mode)

**Purpose:** Checks market reaction metrics since the filing: current price vs. price at filing time, volume spike, bid/ask spread.

**Inputs:** Ticker, `filedAt` timestamp.

**Outputs:**

- `priceChangePct: number` — % change since filing
- `volumeRatio: number` — current volume vs. average
- `isAlreadyMoved: boolean` — true if price moved > threshold set in config

**Used by:** `price-reaction-checker` in technical phase (reads the same data from a shared context, or re-fetches). These can share a common market data fetch if the pipeline context supports passing artifacts between workers.

**Worker definition file:** `electron/main/services/pipeline/workers/fundamental/market-reaction-checker.ts`

---

### 4.4 `price-reaction-checker` (technical phase, catalyst mode)

**Purpose:** Final staleness gate. If price has already moved >3% since filing, the edge is gone. Mark delivery as `dropped (stale)`.

**Inputs:** `priceChangePct` from `market-reaction-checker` output (or re-fetched).

**Drop condition:** If `priceChangePct > 3.0`, set `drop_reason = "stale"`, mark delivery `dropped`.

**Worker definition file:** `electron/main/services/pipeline/workers/technical/price-reaction-checker.ts`

---

## 5. Phase Routing by `processingMode`

The pipeline phase config (wherever workers are registered per mode) must route:

| `processingMode` | Selector workers                       | Fundamental workers                             | Technical workers                                  |
| ---------------- | -------------------------------------- | ----------------------------------------------- | -------------------------------------------------- |
| `catalyst`       | `catalyst-feed-scout`                  | `document-extractor`, `market-reaction-checker` | `price-reaction-checker`, `volume-profile` (keep)  |
| `trend_scan`     | existing web-search workers            | existing fundamental workers                    | existing technical workers (minus removed TA ones) |
| `contract`       | existing contract workers (unchanged)  | existing                                        | existing                                           |
| `manual`         | `catalyst-feed-scout` (no documentUrl) | `market-reaction-checker`                       | `price-reaction-checker`                           |

---

## 6. Checklist

- [ ] `chart-pattern` worker removed from technical phase config + file deleted
- [ ] `momentum-indicator` worker removed from technical phase config + file deleted
- [ ] `sentiment-context` worker removed from fundamental phase config + file deleted
- [ ] `trend-scout` worker removed from selector phase config + file deleted
- [ ] `catalyst-feed-scout` added to selector phase under catalyst + manual modes
- [ ] `document-extractor` added to fundamental phase under catalyst mode
- [ ] `market-reaction-checker` added to fundamental phase under catalyst mode
- [ ] `price-reaction-checker` added to technical phase under catalyst + manual modes
- [ ] Drop conditions implemented: `not_material`, `invalid_ticker`, `stale`
- [ ] `processingMode = "trend_scan"` still routes to web-search worker set
- [ ] `tsc --noEmit` passes
- [ ] Manual end-to-end test: EDGAR signal enters queue → `catalyst-feed-scout` evaluates → pipeline completes or drops with correct reason
