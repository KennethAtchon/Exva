# Exva UI Overhaul — Full Redesign Plan

**Status:** Draft — awaiting Ken's sign-off on Core Decisions below.
**Executor:** Any agent with repo access. Read this whole doc before touching code.
**Scope:** Complete visual + spatial redesign of the renderer (`src/`). No behavior changes, no IPC/main-process changes, no schema changes.

---

### TLDR: shortcuts taken

Self-snitch list. Every guess and corner cut in this plan:

1. **No before-screenshots were taken while writing this plan.** The diagnosis of the current UI comes from reading `src/styles.css`, `TopNav.tsx`, `custom-ui/index.tsx`, and hub/panel source — not from rendered pixels. The executing agent MUST take before-screenshots in Phase 0 and re-validate the diagnosis.
2. **Font choices (Instrument Sans + IBM Plex Mono) were not rendered side-by-side before being specified.** They are a reasoned call (see Core Decisions), but Ken has not seen them on screen. Phase 0 produces a type-specimen screenshot for approval before any hub is touched.
3. **The palette hex values below were picked by eye/theory (oklch reasoning), not validated against WCAG contrast programmatically.** Phase 0 includes a contrast check step; adjust lightness values if any text/bg pair fails 4.5:1.
4. **Panel-level effort estimates are guesses.** `strategy-config-panel.tsx` (1,960 lines) and `dev-panel.tsx` (2,761 lines) may hide coupling that makes "rebuild the layout" slower than phased here.
5. **Light mode is specced as a token flip, not a separate design.** If the inverted palette looks bad in practice, light mode needs its own pass — flagged, not planned.
6. **The bottom event tape assumes the runtime event stream (`useExvaEvent`) emits enough events to feel alive.** If it's sparse in paper mode, the tape shows heartbeat + last-event-age instead. Executor verifies in Phase 1.
7. **Charts (equity curve, cost breakdown) get restyle guidance only, not full redesign specs** — they're canvas/SVG internals; specifying every axis tick here would be fiction.

---

### User journey

Narrated in Ken's words, end to end, in the redesigned app:

> I open Exva. A dark graphite window comes up — left edge has a slim icon rail (Dashboard, Sessions, Signals, Research, Settings, and Docs pinned at the bottom). Across the top there's one thin context bar: which session I'm focused on (or "Global"), a PAPER/LIVE pill I cannot miss, and the run controls (Start/Pause/Stop) right there. Along the very bottom runs the tape — a one-line mono ticker showing what the agents just did: "14:02:11 · selector picked NVDA · technical scoring · risk gate passed". The app feels alive without me clicking anything.
>
> I land on **Dashboard**. Top-left is the number I care about: today's P&L, big, mono, green or red — nothing else competes with it. Under it, a row of small stats (open positions, win rate, spend today, pending approvals). Right side: the equity curve. Below: attention items first (anything needing approval or a session in `attention_required`), then recent trades. If nothing needs me, the page says so plainly and I close the laptop.
>
> I click **Sessions**. A list of session cards on the left — each shows name, status dot, env, P&L sparkline; the focused one is highlighted. The right pane shows the focused session's run view: live pipeline trace, positions, controls. Tabs (Run / Trades / Config) sit under the session header, not floating in a hub-level toolbar. Config is dense but grouped — strategy, risk, brokers, AI — with a sticky save bar when I've changed something.
>
> Everything everywhere uses the same fonts, the same 8px spacing rhythm, the same badge/table/card shapes. Green always means positive/buy, red always negative/sell, amber always caution. The only "brand" color is the bone-white of active/selected things — color is reserved for market meaning. When I hit ⌘K the palette opens instantly and looks like it belongs. Nothing anywhere looks like a different app bolted on.

If any built screen can't be narrated like this, the executor stops and fixes it before moving on.

---

### Core decisions (sign-off required)

Ken confirms/overrides these before execution starts:

1. **Aesthetic direction: "Terminal Ledger."** Warm graphite carbon surfaces + paper-bone text + hairline borders. **Color is reserved exclusively for market meaning** (P&L, status, risk); all chrome/interaction is monochrome — active nav, primary buttons, focus rings are bone-on-ink / ink-on-bone, not a blue accent. This kills the current periwinkle accent entirely. It is the signature restraint move (Linear-style: decoration is latency) and what makes Exva not look like every dark AI dashboard.
2. **Typography: Instrument Sans (UI) + IBM Plex Mono (all data/numerals/labels), bundled locally via `@fontsource`, Google Fonts CDN removed, CSP tightened.** Replaces Inter (AI-slop default) and JetBrains Mono. Two families only. Approve from the Phase 0 type specimen screenshot.
3. **Shell restructure: left icon rail + top context bar + bottom event tape.** The current horizontal TopNav _and_ the collapsible AppNavSidebar both die; there is one nav (the rail). The **tape is the signature element** of the whole app. This is a real spatial change, not a reskin.
4. **shadcn `ui/` primitives get restyled in place (same APIs); `custom-ui` and every hub/panel get their layout rebuilt from scratch** per the specs below. Panels are rebuilt one phase at a time with screenshot checkpoints — Ken reviews screenshots at every phase gate before the next phase starts.
5. **Light mode survives as a token inversion of the same system** (deliverable, verified per phase), not a separately designed theme. Accept, or cut light mode from scope, or demand a real light design (adds ~30% effort).

---

## 1. Diagnosis — why the current UI is subpar

Grounded in source, to be confirmed with Phase 0 screenshots:

| Problem                                                                                      | Evidence                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Generic "dark shadcn + blue accent" look — indistinguishable from any AI-generated dashboard | `src/styles.css`: blue-black bg (`hsl 220 23% 5%`), periwinkle primary (`231 87% 69%`), Inter + JetBrains Mono from Google CDN (`index.html:22`)                         |
| Two competing navigation systems                                                             | `TopNav.tsx` (horizontal hub tabs) **and** `AppNavSidebar.tsx` (collapsible sidebar) both exist and both navigate the same 5 hubs                                        |
| No type scale — ad-hoc pixel values everywhere                                               | `text-[13px]`, `text-[12px]`, `text-[17px]` sprinkled through `TopNav.tsx` and panels; no named scale                                                                    |
| Style-object soup instead of components                                                      | `TopNav.tsx` `navClass` object: 25+ inline Tailwind strings defining pills, buttons, badges that duplicate what `ui/` and `custom-ui` already provide                    |
| Two parallel design systems                                                                  | `ui/` (shadcn tokens: `--primary`, `--muted`) and the raw token set (`--surface`, `--text1`, `--accent`) coexist; components mix both                                    |
| Six semantic hues + a brand accent = color noise                                             | success/error/warning/info/market/orange **plus** periwinkle accent all fight on the same screens                                                                        |
| Density without rhythm                                                                       | 15,800 lines of panel code with no shared spacing grid, section header, or empty-state pattern                                                                           |
| Hardcoded styling everywhere — tokens unusable as Tailwind classes                           | 1,282 `[var(--…)]` arbitrary refs, 1,226 arbitrary px values, 77 inline `style={{}}`, 3 files with `cva`; raw tokens never registered in `tailwind.config.js` (see §2.4) |

## 2. Design system spec

### 2.1 Tokens — replace the token block in `src/styles.css`

All values below are the **only** colors the executor may use. No invented hex anywhere else. Semantic token _names_ and the THEMING.md contract are preserved (Tailwind classes `text-success`, `bg-error-dim`, etc. keep working); values are retuned to the new palette temperature.

```css
:root {
  /* == Terminal Ledger — dark (default) ================== */
  /* Surfaces: warm graphite carbon, not blue-black */
  --bg: #131311; /* window */
  --surface: #191917; /* rail, context bar, tape, cards */
  --surface2: #1f1f1c; /* nested cards, inputs, hover */
  --surface3: #2a2a26; /* active/pressed, chips */
  --border: #2b2b26; /* card borders */
  --hairline: #232320; /* internal dividers, table rules */

  /* Text: paper bone, not white */
  --text1: #e8e6dd;
  --text2: #98968b;
  --text3: #605e53;

  /* Interaction is monochrome — accent aliases bone */
  --accent: var(--text1);
  --accent-dim: rgba(232, 230, 221, 0.08);

  /* Semantic market colors (slightly warmed to match carbon) */
  --color-success: #4ade80;
  --color-success-dim: rgba(74, 222, 128, 0.09);
  --color-success-border: rgba(74, 222, 128, 0.28);
  --color-error: #f4655f;
  --color-error-dim: rgba(244, 101, 95, 0.1);
  --color-error-border: rgba(244, 101, 95, 0.3);
  --color-warning: #e9b44c;
  --color-warning-dim: rgba(233, 180, 76, 0.1);
  --color-warning-border: rgba(233, 180, 76, 0.3);
  --color-info: #7eb3e8;
  --color-info-dim: rgba(126, 179, 232, 0.1);
  --color-info-border: rgba(126, 179, 232, 0.28);
  --color-market: #b49fe8;
  --color-market-dim: rgba(180, 159, 232, 0.1);
  --color-market-border: rgba(180, 159, 232, 0.28);
  --color-orange: #ef8e51;
  --color-orange-dim: rgba(239, 142, 81, 0.12);
  --color-orange-border: rgba(239, 142, 81, 0.35);

  --radius: 4px; /* sharper instrument feel; was 0.6rem */
  --font-sans: "Instrument Sans", system-ui, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, monospace;
}

.light {
  --bg: #f1f0ea; /* warm paper, not slate */
  --surface: #faf9f5;
  --surface2: #edece5;
  --surface3: #e2e1d8;
  --border: #d6d4c8;
  --hairline: #e3e1d6;
  --text1: #1c1c18;
  --text2: #5a5950;
  --text3: #98968b;
  --accent: var(--text1);
  --accent-dim: rgba(28, 28, 24, 0.07);
  /* semantic colors: darken each DEFAULT ~15% lightness for contrast on paper;
     dims go to .14–.18 alpha per THEMING.md */
}
```

Also remap the shadcn HSL block (`--background`, `--card`, `--primary`, `--muted`, …) to point at the same palette: `--primary` = bone (`--text1`) with ink foreground, `--ring` = bone at 60% alpha, `--radius` = 4px. `ui/` components then inherit the new look with zero API change.

**Contrast gate (Phase 0):** verify `--text2` on `--surface` ≥ 4.5:1 and every semantic DEFAULT on `--bg` ≥ 3:1 (they're used at ≥14px mono). Adjust lightness only, keep hue.

### 2.2 Typography

Install: `bun add @fontsource/instrument-sans @fontsource/ibm-plex-mono`. Import weights 400/500/600 (sans) and 400/500/600/700 (mono) in `src/styles.css`. Delete the Google Fonts `<link>` tags from `index.html` and remove `fonts.googleapis.com` / `fonts.gstatic.com` from the CSP — local-first app, zero network fonts.

Named scale — add to `tailwind.config.js` `fontSize` and use ONLY these (no more `text-[13px]`):

| Token          | Size/line                             | Face     | Use                                        |
| -------------- | ------------------------------------- | -------- | ------------------------------------------ |
| `text-micro`   | 10.5/14, uppercase, tracking 0.08em   | mono 500 | eyebrows, table headers, tape, axis labels |
| `text-caption` | 12/16                                 | sans 400 | help text, secondary meta                  |
| `text-body`    | 13/20                                 | sans 400 | default UI text                            |
| `text-label`   | 13/20, 500                            | sans     | buttons, form labels, nav                  |
| `text-data`    | 13/20 tabular                         | mono 400 | table cells, prices, IDs                   |
| `text-head`    | 15/22, 600                            | sans     | card/section titles                        |
| `text-title`   | 19/26, 600, tracking -0.01em          | sans     | hub/panel titles                           |
| `text-stat`    | 26/30, 600 tabular                    | mono     | stat tiles                                 |
| `text-hero`    | 40/44, 600, tracking -0.02em, tabular | mono     | dashboard P&L                              |

Rules: every numeral that can change width is mono tabular (`font-feature-settings: "tnum"` on `--font-mono` usage). Uppercase micro-labels are the structural voice of the app — section eyebrows, table headers, tape entries. Sans never renders numbers in tables.

### 2.3 Spacing, shape, elevation, motion

- **8px grid**: paddings/gaps from {4, 8, 12, 16, 24, 32}. Card padding 16; page gutter 24; section gap 24.
- **Radius**: 4px everywhere (`--radius`); pills/badges 3px; NO fully-rounded pills except the env indicator and status dots.
- **Elevation = borders, not shadows.** Cards: `bg-[var(--surface)] border border-[var(--border)]`. Nested: `--surface2` + `--hairline`. Popovers/dialogs get one shadow token: `0 8px 24px rgba(0,0,0,.45)`.
- **Motion**: 120ms ease-out for hover/press, 180ms for panel transitions; the tape scrolls new entries in with a 240ms slide. One page-load moment: dashboard stats count up once (400ms). Everything wrapped in `@media (prefers-reduced-motion: reduce)` → off. Nothing else animates.
- **Focus**: `outline: 1.5px solid var(--text1); outline-offset: 2px` on every interactive element. Keyboard-visible, always.

### 2.4 Style architecture — kill the hardcoded-CSS pattern

Measured state of `src/` (2026-07-13): **1,282 `var(--…)` arbitrary-value refs**, **1,226 arbitrary pixel/rem values** (`text-[13px]`, `h-[58px]`, …), **77 inline `style={{}}` blocks**, only 3 files using `cva`. Worst offenders: `dev-panel.tsx` (176 var refs), `trade-autopsy-panel.tsx` (99), `period-autopsy-panel.tsx` (72), `TradeDetail.tsx` (64).

Root cause: the raw tokens (`--bg`, `--surface`, `--text1`, `--hairline`, …) are **not registered as Tailwind theme colors**, so every consumer is forced into `bg-[var(--surface)]` escape-hatch syntax. Fix the cause in P0, then the sweep is mechanical:

1. **Register every token in `tailwind.config.js`** (P0): `colors: { bg, surface, surface2, surface3, chip, border, hairline, text1, text2, text3, accent, "accent-dim", … }` mapping to `var(--…)`. From then on the ONLY spellings are `bg-surface`, `text-text2`, `border-hairline`, etc. `bg-[var(--anything)]` is banned in new/rebuilt code.
2. **Named scales replace arbitrary values** (P0): the §2.2 `fontSize` scale, plus `spacing`/`height` additions for the shell constants (`rail: 56px`, `contextbar: 44px`, `tape: 28px`). Target: zero `-[Npx]` outside genuinely computed one-offs.
3. **Variants live in `cva`, not class-map objects or ternary soup** (P2): Button/Badge/StatTile/pills defined once with `cva` variant maps. The `navClass`-style const objects (2 today) are banned.
4. **Inline `style` only for computed values** — THEMING.md's existing rule, now enforced: `transform: scaleX(${v})`, dynamic chart colors = fine; static strings = Tailwind class. The 77 current blocks get triaged during each hub's rebuild phase (most are static and convert; ~15 are genuinely dynamic and stay).
5. **Enforcement, not discipline** (P0): add ESLint guards so it can't regress — `no-restricted-syntax` on `JSXAttribute[name.name="style"]` with literal-only object values, and a `no-restricted-syntax`/regex rule (or `eslint-plugin-tailwindcss`) flagging `\[var\(--` and `-\[[0-9]+px\]` in `className`. Existing violations get file-level disables that burn down phase by phase; P8 removes the last disables.

Per-phase gate addition: every rebuilt file must pass the new lint rules with no disable comment. P8's grep sweep (`grep -rn "\[var(--" src/ --include=*.tsx` and the pixel grep) must return zero.

## 3. Shell — new spatial structure

Delete-and-rebuild: `TopNav.tsx` (NavShell) and `AppNavSidebar.tsx` are replaced by three new components. Do not edit the old markup — write `src/components/shell/` fresh (`Rail.tsx`, `ContextBar.tsx`, `EventTape.tsx`, `Shell.tsx`), then swap in `App.tsx` and delete the old files.

```
┌──┬──────────────────────────────────────────────────────────┐
│▓ │ CONTEXT BAR  Global ▾ · Momentum-A   [PAPER]  ▶ ⏸ ■   ⌘K │ 44px
│▓ ├──────────────────────────────────────────────────────────┤
│▓ │                                                          │
│R │                                                          │
│A │                    HUB CONTENT                           │
│I │              (24px gutters, 8px grid)                    │
│L │                                                          │
│▓ │                                                          │
│▓ ├──────────────────────────────────────────────────────────┤
│▓ │ TAPE ● 14:02:11 RISK GATE PASSED NVDA · 14:01:48 TECH…   │ 28px
└──┴──────────────────────────────────────────────────────────┘
 56px
```

- **Rail (56px fixed):** logo glyph top; 5 hub icons (from `src/lib/nav.ts`, unchanged ids); Docs + theme toggle pinned bottom. Active = bone icon + 2px bone left bar; inactive = `--text3`, hover `--text2`. Tooltips with labels + shortcut hints. No expandable mode in v1 (cut: the old sidebar's expanded state) — labels live in tooltips and the context bar breadcrumb.
- **Context bar (44px):** left — breadcrumb `hub / focused-session` with session switcher dropdown (workspace store already has focus state); center-right — env pill (PAPER = warning tones, LIVE = success tones; only always-colored chrome element, deliberately), session status dot+label, run controls (Start/Pause/Stop/Stop-when-flat — same handlers as current TopNav, restyled: primary = bone bg/ink text, destructive = error-dim), ⌘K button. Attention count badge (error tones) sits on the breadcrumb when > 0.
- **Event tape (28px, signature):** mono `text-micro`, uppercase. Left: pulse dot (heartbeat = session active). Then most-recent-first runtime events from `useExvaEvent`, timestamped, colored by semantic phase (reuse `AGENT_LABEL` variants from custom-ui). New entries slide in from the right; hover pauses; click opens the relevant trade/trace. Idle state: `IDLE · LAST EVENT 4M AGO · DB OK`. Never empty, never blank.

## 4. Component system (`src/components/ui` + `custom-ui`)

Restyle in place, same exported APIs (panels keep compiling):

- **Button**: variants → `primary` (bone bg, ink text), `secondary` (surface2 + border), `ghost`, `destructive` (error-dim/border/text), `warning` (warning-dim — replaces TopNav's ad-hoc pause/stop classes). Sizes sm(26px)/md(32px). Label = `text-label`; icon-only = square.
- **Card**: surface + border + 4px radius; new `CardHeader` pattern = micro eyebrow + `text-head` title + optional right-side action — this becomes THE section header across all panels.
- **Table**: header row = `text-micro` uppercase `--text3` with hairline bottom rule; cells `text-data` mono for numeric, `text-body` sans for names; row hover `--surface2`; numeric columns right-aligned; no zebra.
- **Badge** (custom-ui): keep variant map, restyle: 3px radius, mono `text-micro`, `-dim` bg + `-border` (unchanged semantics).
- **Tabs**: underline style (2px bone bar), `text-label`, no filled backgrounds.
- **Input/Select**: `--surface2` bg, hairline border, focus = bone outline; height 32px.
- **Dialog/Popover/DropdownMenu/CommandPalette**: `--surface` + border + the one shadow token; palette (`CommandPalette.tsx`) restyled to match — mono micro group headers, bone selection bar.
- **New primitives** (small, shared, built once in Phase 2): `StatTile` (micro label + `text-stat` mono value + optional delta in semantic color), `EmptyState` (icon + one plain sentence + one action button — used by every panel; errors state what went wrong and the next step, never apologize), `SectionHeader` (the eyebrow pattern), `PnL` (formats + colors a signed value, tabular; the ONLY way P&L is ever rendered).
- **Kill**: all `navClass`-style inline class objects; every ad-hoc pill/badge/button in panels migrates to these primitives.

## 5. Hub-by-hub rebuild specs

Every hub: rebuild the layout from scratch (new spatial structure — if before/after screenshots show the same block arrangement, the phase failed). Reuse existing data hooks/stores untouched.

### 5.1 Dashboard (`DashboardHub.tsx`, 672 lines)

```
┌ P&L TODAY ──────────────┐ ┌ EQUITY CURVE ──────────────────┐
│  +$1,284.02   +2.1%     │ │            (chart)             │
│  hero mono, semantic    │ │                                │
├─ stat row ──────────────┤ │                                │
│ POS 4 · WIN 62% · SPEND │ │                                │
│ $3.12 · PENDING 1       │ └────────────────────────────────┘
├ NEEDS ATTENTION ────────────────────────────────────────────┤
│ approval cards / attention_required sessions (error-toned)  │
├ RECENT TRADES ──────────────────────┬ SESSIONS ─────────────┤
│ table (last 10, → TradeDetail)      │ compact session list  │
└─────────────────────────────────────┴───────────────────────┘
```

Hero P&L is the one big thing; nothing else exceeds `text-stat`. "Needs attention" section renders only when non-empty; otherwise the trades/sessions row moves up. Empty day: EmptyState "No trades yet today. The pipeline runs automatically while a session is active."

### 5.2 Sessions (`SessionsHub.tsx` + `sessions-panel`, `trades-panel`, `strategy-config-panel`)

Master-detail replaces the current tab-first layout:

```
┌ SESSION LIST (300px) ┬ FOCUSED SESSION ──────────────────────┐
│ [card] Momentum-A ●  │ Momentum-A  [PAPER] ● Active          │
│  paper · +$120 ▁▂▃▅  │ Run | Trades | Config   (underline)   │
│ [card] Earnings-B ○  │ ┌───────────────────────────────────┐ │
│ [+ New session]      │ │ tab content                       │ │
│ filter: status ▾     │ └───────────────────────────────────┘ │
└──────────────────────┴───────────────────────────────────────┘
```

Run tab = live pipeline trace (phase badges via `AGENT_LABEL`) + open positions + controls. Config tab = `strategy-config-panel` rebuilt as grouped sections (Strategy / Risk / Brokers & Instruments / AI models) with `SectionHeader`s, two-column form grid, sticky bottom save bar on dirty state; config-locked while active shows a plain locked banner (warning tones). Trades tab = trades table with the comprehensive filters as a compact filter row (selects + chips), not a wall of controls.

### 5.3 Signals (`SignalsHub.tsx` + signal-sources, event-sources, instrument-sets, data-doctor)

Overview = grid of source cards (name, type badge, enabled switch, last-scan time, health dot) grouped Signal sources / Event sources. Instruments tab = sets as cards with member chips. Doctor tab = checks table (pass/fail semantic dots) + one "Run checks" primary button.

### 5.4 Research (`ResearchHub.tsx` + autopsies, leaderboard, costs, backtest lab, equity curve, briefing)

Scorecards tab: leaderboard table (mono numerics, right-aligned) + equity curve; Autopsies: period selector + verdict cards; Costs: `cost-breakdown-panel` as StatTile row + breakdown table; Lab: form left / results right split. Charts: restyle only — carbon bg, hairline gridlines, `text-micro` mono axis labels, semantic line colors, 1.5px strokes, no fills/gradients.

### 5.5 Settings (`SettingsHub.tsx` + accounts, brokers, dev ` panels)

Narrow content column (max-w 760px), left-anchored sub-nav list (Accounts / Brokers / Developer) instead of top tabs. Accounts/brokers become row-cards with status + actions. Dev panel (2,761 lines): restyle with the shared primitives, do NOT restructure — lowest-value surface; log viewer keeps `--color-log-*`.

### 5.6 Docs, TradeDetail, Autopsy pages, dialogs & overlays

DocsPage: readable measure (max-w 720px), `text-title`/`text-head` hierarchy, mono inline-code chips. TradeDetail + trade-autopsy: header block (instrument, side badge, `PnL`, timestamps) + timeline of pipeline phases with trace excerpts in mono blocks. LiveReadinessModal: checklist rows with pass/fail dots, ack checkbox, LIVE confirmation button in error tones (deliberate friction). RuntimeEventToast + AssistantSlideOver restyled to system.

## 6. Execution phases & checkpoints

**Hard rules for the executor (non-negotiable):**

- After EVERY phase: launch the app, screenshot each changed screen, **Read/look at every PNG yourself**, then post before/after to Ken and STOP until he approves. No phase proceeds on unreviewed screenshots. Small chunks, human eyes, tight loop.
- Screenshots: use the Playwright electron harness (`e2e/helpers/launch-app.ts`) — add a small `scripts/ui-snap.ts` in Phase 0 that launches the app, navigates to a given hub, saves a PNG (dark + light). `scripts/snap.sh <url>` only works if `bun run dev:renderer` renders standalone; verify once, else use the Playwright route.
- Every color from §2.1, every size from §2.2, every gap from §2.3. A value not in the spec is a bug in the plan — flag it, don't invent.
- `bun run typecheck && bun run lint && bun run test` green at every phase gate; `bun run test:e2e` green at P1, P3 and P8 (nav/dashboard specs will need selector updates when the shell changes — update them honestly, don't skip).
- Surgical: renderer only. Don't touch `electron/`, stores' logic, or data hooks. Don't "improve" adjacent logic while restyling.

| Phase                                 | Work                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Gate artifact                                                             |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **P0 Foundation**                     | Before-screenshots of all 6 hubs (dark+light). Fonts via @fontsource; CSP tightened; new tokens in `styles.css` (both themes); **register all tokens as Tailwind colors + named scales + ESLint guards (§2.4)**; contrast check; `ui-snap.ts`. App will look half-broken — expected.                                                                                                                                                                       | Type specimen + token swatch screenshot → Ken approves direction          |
| **P1 Shell**                          | Build `components/shell/` (Rail, ContextBar, EventTape, Shell); swap into `App.tsx`; delete TopNav/AppNavSidebar; update nav e2e specs. Verify tape event density (TLDR #6).                                                                                                                                                                                                                                                                               | Shell screenshots, all hubs reachable                                     |
| **P2 Components**                     | Restyle all of `ui/`; rebuild `custom-ui`; new StatTile/EmptyState/SectionHeader/PnL; CommandPalette, toasts, dialogs.                                                                                                                                                                                                                                                                                                                                     | Component gallery screenshot (temp dev route or storybook-less grid page) |
| **P3 Dashboard**                      | §5.1 rebuild.                                                                                                                                                                                                                                                                                                                                                                                                                                              | Before/after                                                              |
| **P4 Sessions**                       | §5.2 master-detail + config + trades + readiness modal. Biggest phase — may split into 4a (list/run) and 4b (config/trades).                                                                                                                                                                                                                                                                                                                               | Before/after per tab                                                      |
| **P5 Signals**                        | §5.3.                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Before/after                                                              |
| **P6 Research**                       | §5.4 incl. chart restyle.                                                                                                                                                                                                                                                                                                                                                                                                                                  | Before/after                                                              |
| **P7 Settings + Docs + Detail pages** | §5.5, §5.6.                                                                                                                                                                                                                                                                                                                                                                                                                                                | Before/after                                                              |
| **P8 Polish**                         | Light-mode pass on every screen; focus-visible audit (tab through every hub); reduced-motion check; empty/error state sweep; **remove all remaining §2.4 lint disables**; kill every remaining `-[Npx]`, `[var(--`, and off-token hex (`grep -rn "\[var(--" src/ --include=*.tsx`, `grep -rEo "\-\[[0-9]+px\]" src/ -r`, `grep -rnE "#[0-9a-fA-F]{3,6}" src/ --include=*.tsx` must come back clean or justified); delete dead styles; run `bun run check`. | Full app walkthrough screenshots, dark + light                            |

**Success criteria (loop until true):** every hub screenshot passes the litmus test "same app, one designer"; zero non-token colors/sizes in `src/`; all checks green; the tape is alive; before/after shows new spatial structure on every hub, not a palette swap.

**Out of scope:** new features, main-process changes, DB changes, copy rewrites beyond what layouts require (though all new copy follows: active voice, sentence case, plain verbs, errors state cause + next step), app icon/logo asset design (separate asset-design task if wanted).
