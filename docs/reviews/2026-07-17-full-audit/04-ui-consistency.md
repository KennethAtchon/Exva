# UI Consistency Review — Renderer-wide

Audit date: 2026-07-17. Audience: an executing AI agent. Scope: all of `src/` (shell, 5 hubs, 18 panels, feature components). The assistant chat surface has its own deeper doc (`05-ai-interface-redesign.md`); its findings are cross-referenced, not repeated.

### TLDR: shortcuts taken

- This sweep was done via repo-wide pattern greps plus sampled file reads, not a line-by-line read of all 18 panels — counts below are exact, but there may be additional per-panel layout quirks not listed.
- **No screenshots were taken for this doc.** Visual verification is mandatory during execution: launch the app, screenshot each touched surface (`scripts/ui-snap.ts`), and eyeball before/after.
- Loading-state coverage was measured by pattern (`skeleton`/"Loading…" occurrences), not by driving every async path in the running app.

### User journey (target)

1. Ken moves between Dashboard → Sessions → any panel: same header rhythm, same spacing, same badge/status language everywhere — nothing feels like a different app.
2. Every destructive action (delete preset, force stop, remove provider) opens the same styled confirm dialog — never a native browser popup.
3. Every async surface shows a consistent loading skeleton, a consistent empty state with a next-step hint, and a consistent inline error — no blank flashes, no `alert()`.
4. Every currency, percent, and timestamp is formatted identically in every panel.

### Core decisions (sign-off required)

1. **Canonical token vocabulary = the app's own system** (`text-text1/2/3`, `bg-surface*`, semantic status tokens per `THEMING.md`) — the shadcn vocabulary (`text-muted-foreground`, `bg-card`, `text-foreground`) gets migrated out of app components. Usage data says this is already the de-facto standard (see §2). Alternative (migrate everything to shadcn tokens) means rewriting ~1,000 usages instead of ~55.
2. **One Badge, one Card, one EmptyState, one section-header** — consolidate the duplicate implementations (§3.2). Recommended: keep the `src/components/ui` + `primitives.tsx` versions, fold `custom-ui` and `dna.tsx` variants into them.
3. **Introduce `src/lib/format.ts`** as the single number/date formatter module and sweep all ad-hoc `toFixed` call sites. Recommended: yes.
4. **Replace all native `window.confirm/prompt/alert`** with the existing Radix `Dialog` (build a small shared `ConfirmDialog`). Recommended: yes — 9 files affected.

---

## 1. Design system overview (what exists)

- **Tokens:** CSS variables in `src/styles.css`, documented in `THEMING.md` — surfaces (`--surface`, `--surface2`, `--surface3`), text ramp (`--text1..3`), status colors with `-dim`/`-border` variants (success/error/warning/info/market/orange), log-level colors. Dark default, `.light` override on `<html>`.
- **Type scale:** `tailwind.config.js:23-31` — `text-micro`, `text-caption` (13px), `text-body` (14px), `text-head` (16px/600). Fonts: Instrument Sans + IBM Plex Mono (`@fontsource`).
- **Component kits (three of them — part of the problem):**
  - `src/components/ui/` — shadcn-style Radix kit (badge, button, card, dialog, table, tabs, select, tooltip, …) plus `primitives.tsx` (`SectionHeader`, `StatTile`, `EmptyState`, `PnL`).
  - `src/components/custom-ui/index.tsx` — a second kit: its own `Badge`, `Dot`, `AgentLabel`, `SectionTitle`, `Card`, `ShadcnSelect` wrapper.
  - `src/hubs/dna.tsx` — hub-level layout DNA including `HubEmptyState` (`dna.tsx:322`).
- **Enforcement that already works:** zero raw hex colors and zero arbitrary Tailwind values (`text-[13px]`-style) in `src/**/*.tsx` — token discipline at the value level is genuinely clean. The `theming/no-static-inline-styles` ESLint rule exists per `THEMING.md`.

## 2. Canonical patterns (normalize toward these)

Measured usage across `src/**/*.tsx`:

| Pattern       | Canonical (usage)                                                      | Deviant (usage)                                         | Where deviants live                                                                                                                                                                    |
| ------------- | ---------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Text ramp     | `text-text1` 230 / `text-text2` 194 / `text-text3` 363                 | `text-muted-foreground` 22, `text-foreground` 17        | `components/control/*`, `custom-ui/index.tsx`, `autopsy/AndonCordCard.tsx`, `autopsy/PeriodLessonsPanel.tsx`, `approvals/PendingApprovalsPanel.tsx`, `panels/period-autopsy-panel.tsx` |
| Surfaces      | `bg-surface*` 279                                                      | `bg-card` 16                                            | same files                                                                                                                                                                             |
| Status colors | semantic tokens (`text-success`, `bg-warning-dim`, …) per `THEMING.md` | raw palette (`amber-500`, `emerald-500`) 12 occurrences | `control/ToolCallCard.tsx` (8), `control/ConfirmationCard.tsx` (4) — the ONLY raw-palette usages in the app                                                                            |
| Empty state   | `EmptyState` from `ui/primitives.tsx:68` (15 files)                    | `HubEmptyState` (`hubs/dna.tsx:322`) + inline strings   | hubs + a few panels                                                                                                                                                                    |
| Confirm/alert | Radix `Dialog` (`ui/dialog.tsx`)                                       | native `window.confirm/prompt/alert`                    | 9 files, listed in §3.3                                                                                                                                                                |

## 3. Findings, ranked by user-visible impact

### 3.1 The control (assistant) components are a different design system

The chat surface mixes shadcn tokens + raw palette colors inside an app that otherwise uses its own token ramp exclusively (§2 table). This is the "feels like a different app" violation, on the app's most prominent new surface. **Fix:** covered in detail by `05-ai-interface-redesign.md` §3.2 — migrate `src/components/control/*` to `text-text*/bg-surface*/semantic status tokens`. Also migrate the five non-control files listed in §2 (each is a ~15-minute mechanical swap: `text-muted-foreground`→`text-text3`, `text-foreground`→`text-text1`, `bg-card`→`bg-surface2`, verify visually).

### 3.2 Four duplicated primitives

- `Badge`: `ui/badge.tsx` (cva variants) AND `custom-ui/index.tsx:43`.
- `Card`: `ui/card.tsx` AND `custom-ui/index.tsx:113`.
- Section header: `ui/primitives.tsx:7` (`SectionHeader`) AND `custom-ui/index.tsx:107` (`SectionTitle`).
- Empty state: `ui/primitives.tsx:68` (`EmptyState`) AND `hubs/dna.tsx:322` (`HubEmptyState`).

Two implementations drift; new code picks one at random and the app slowly forks visually. **Fix:** for each pair, diff the two implementations, keep the `ui/`-side component (extend with any variant the other had), replace all imports of the duplicate, delete it. Run `bun run knip` after — it will confirm dead exports.

### 3.3 Native browser dialogs (9 files)

`window.confirm`/`window.prompt`/`alert()` at: `App.tsx:272,330`, `sessions/SessionTable.tsx:224`, `autopsy/LessonsPanel.tsx:255,276`, `control/AssistantSlideOver.tsx:33`, `strategy/ConfigHistoryDrawer.tsx:92`, `panels/sessions-panel.tsx:152`, `panels/accounts-panel.tsx:420,427,438,716,884`, `panels/strategy-config-panel.tsx:108,286`. Native popups look broken in a polished desktop app, are unstyled/unthemed, and block the event loop. `App.tsx:330` even uses `window.prompt` as a typed-confirmation gate. **Fix:** build one shared `ConfirmDialog` (and one `TextInputDialog`) on the existing Radix `Dialog`, with destructive variant styling; replace all call sites. `accounts-panel.tsx`'s `alert()`-on-error calls become inline error text (the panel already renders forms — put the error under the form, `text-error`).

### 3.4 No shared formatters — money/percent/time formatted ad hoc

`toFixed(` appears in 12+ UI files (leaderboard, equity-curve, trade-autopsy, period-autopsy, kill-switch, dev, brokers, data-doctor panels, `TradeDetail.tsx`, …). `src/lib/` has no `format.ts`; only `formatIpcError` and `formatConfigSavedAt` exist. Result: currency shown as `1234.5` in one panel and `$1,234.50` in another, mixed sign/percent conventions — in a trading app where numbers ARE the product. **Fix:** create `src/lib/format.ts` with `formatCurrency(value, ccy?)`, `formatPercent(value, dp?)`, `formatCompact(value)`, `formatTimestamp(iso)`, `formatRelative(iso)` (use `Intl.NumberFormat`/`Intl.DateTimeFormat`, no new deps); then sweep every `toFixed` call site in `src/` to the appropriate formatter. Keep the `PnL` primitive (`ui/primitives.tsx:110`) as the one way to render signed PnL and route it through the same formatter.

### 3.5 Loading states are nearly absent

Only `dev-panel.tsx` references a skeleton and only `cost-breakdown-panel.tsx` shows a "Loading…" string; the other ~16 panels render nothing (or stale layout) while queries resolve. **Fix:** add a `Skeleton` primitive to `ui/` (simple `animate-pulse bg-surface3 rounded` block), plus a `PanelLoading` composition (title bar + 3 row skeletons), and wire it into each panel's TanStack Query `isLoading` branch. Uniform rule: every panel renders exactly one of skeleton / `EmptyState` / error / content.

### 3.6 Empty-state fork + inline one-offs

15 files use `EmptyState`, some hubs use `HubEmptyState`, and several panels inline raw strings (`sessions-panel.tsx:842-843`, `dev-panel.tsx:1030`). **Fix:** after the 3.2 consolidation, convert inline strings to the single `EmptyState` with `title` + actionable `message` (the DashboardHub ones at `DashboardHub.tsx:472-476` are the model: state + what happens next).

### 3.7 Accessibility floor

30 `aria-label`s app-wide; icon-only buttons mostly rely on `title` (e.g. all four header buttons in `AssistantSlideOver.tsx:73-105`). Keyboard focus styling depends on the shadcn `Button` defaults where used, but raw `<button>` elements (e.g. tool card headers, `ToolCallCard.tsx:67-71`) have no visible focus ring. **Fix (mechanical sweep):** every icon-only `Button` gets `aria-label` matching its `title`; every raw `<button>` gets `focus-visible:ring-1 focus-visible:ring-info-border` (or migrates to the `Button` component with `variant="ghost"`).

### 3.8 Keep what works

Zero hex literals, zero arbitrary utilities, tokens well-documented, one shared `cn()` idiom, Radix used consistently where dialogs/menus exist. The system is 90% coherent — the fixes above are convergence work, not a redesign. Do **not** restyle panels beyond the listed normalizations.

## 4. Execution order

1. §3.3 shared ConfirmDialog + replace native dialogs (small, everywhere-visible win).
2. §3.4 `format.ts` + sweep.
3. §3.2 primitive consolidation, then §3.6 empty-state normalization.
4. §3.5 skeleton/loading rollout.
5. §3.1 token migration (control components last — coordinate with doc 05 execution).
6. §3.7 a11y sweep.

After each step: `bun run check`, then screenshot affected panels in the running app and compare against §User journey. Never mark a visual step done from code alone.
