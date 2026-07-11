# Theming Refactor — Plan

> **Date:** 2026-05-26
> **Status:** Decided
> **Deciders:** Kenneth

---

## 1. Problem Statement

Exva's renderer cannot be re-themed by editing a single file. There are **247 hardcoded hex color values** scattered across 20+ source files, and **823 inline `style={{}}` blocks** (vs 138 `className=` uses) spread across pages and components. The CSS variable system in `styles.css` exists and is structurally sound, but it is bypassed constantly in practice.

The concrete impact: if you want to change "error red" from `#f87171` to any other value, you must touch at least 44 occurrences in 15 different files. Static layout properties (height, width, borderRadius, transition, transformOrigin) are also scattered as inline styles instead of Tailwind classes, which means:

1. Adjacent AI agents editing different files all drift toward their own local conventions.
2. There is no enforced boundary between "static style" and "dynamic computed value."
3. Light/dark mode requires touching every file because colors are baked in.

The five main semantic color roles each have 2–5 hex aliases used inconsistently across files:

| Semantic role            | Aliases found                                         | Count |
| ------------------------ | ----------------------------------------------------- | ----- |
| Error / sell / negative  | `#f87171`, `#fca5a5`, `#fecaca`, `#ff4757`, `#ff7b8a` | 78    |
| Success / buy / positive | `#34d399`, `#00e5a0`, `#6ee7b7`, `#86efac`            | 57    |
| Warning / caution        | `#fbbf24`, `#ffb733`, `#fcd34d`, `#fde68a`            | 42    |
| Info / accent-blue       | `#60a5fa`, `#4da6ff`, `#93c5fd`                       | 31    |
| Orange / executing       | `#fb923c`, `#f97316`, `#fdba74`, `#ff8c42`            | 15    |
| Purple / market          | `#a78bfa`, `#c084fc`                                  | 7     |

DevPanel is the worst offender: 3,399 lines, 176 inline style blocks, 0 Tailwind className uses. It uses a local `S.*` style object pattern.

If nothing is done, every sprint that an AI agent touches a file deepens the inconsistency. A light mode, brand change, or accessibility audit becomes a multi-week grep-and-pray.

---

## 2. Goals & Non-Goals

**Goals**

| #   | Goal                                     | Success Looks Like                                                                                              |
| --- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1   | Single-file theme changes                | All color changes require editing only `styles.css`                                                             |
| 2   | One canonical value per semantic role    | No aliases — one `--color-success`, one `--color-error`, etc.                                                   |
| 3   | Light mode support                       | `:root` = dark defaults, `.light` on `<html>` overrides all tokens; toggling that class switches the full theme |
| 4   | Log level colors match semantic tokens   | `--color-log-error` aliases `--color-error`; no separate palette                                                |
| 5   | Static styles → Tailwind className       | Static layout and color props move to `className`; only truly dynamic computed values remain as `style={{}}`    |
| 6   | Clear inline style rule enforced by lint | The boundary: if the value can be written without a JS expression, it belongs in `className`                    |

**Non-Goals**

| #   | Non-Goal                      | Reason                                                                                                                   |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1   | Redesign of visual look/feel  | Refactor only; dark theme values are preserved as-is                                                                     |
| 2   | shadcn/ui component migration | Already Tailwind-correct; leave untouched                                                                                |
| 3   | Removing all inline styles    | Styles with runtime-computed values (e.g., `transform: scaleX(${value/max})`, `width: ${pct}%`) legitimately stay inline |
| 4   | Adding a theme switcher UI    | Tokens and class toggle are in scope; the actual UI control is not                                                       |

---

## 3. Background & Context

### Current system

**`src/styles.css`** — defines two parallel token sets:

1. Tailwind-mapped shadcn vars: `--background`, `--foreground`, `--primary`, `--muted`, etc.
2. Custom vars: `--bg`, `--surface`, `--surface2`, `--surface3`, `--chip`, `--border`, `--text1`, `--text2`, `--text3`, `--accent`, `--accent-dim`

**`tailwind.config.js`** — correctly maps Tailwind color tokens to CSS vars. Missing: semantic status colors (success/error/warning/info/market/orange) — these have no CSS var and no Tailwind token, so every developer reaches for raw hex.

**Fonts** — loaded in `index.html` from Google Fonts. Referenced correctly through `--font-sans: "Inter"` and `--font-mono: "JetBrains Mono"`. No changes needed.

**`.dark` block in `styles.css`** — currently duplicates `:root`. This is redundant and will be removed. Dark is the default (`:root`). `.light` is the override.

### Where the `.light` class lives: `<html>` — not `<body>` or `#root`

Three reasons this is the only correct choice in an Electron + Tailwind app:

1. **Tailwind's class selector** — `darkMode: ["class"]` generates selectors like `.dark .text-foreground { ... }` that walk up to the root. The toggle class must be an ancestor of every styled element including Radix portals and dialogs that teleport outside `#root`. `<html>` is the only guaranteed common ancestor.

2. **Scrollbar theming** — `::-webkit-scrollbar-thumb` and `scrollbar-color` inherit CSS vars reliably only when those vars are on `<html>` / `:root`. If `.light` is on `#root`, scrollbars rendered outside that subtree (Electron's native window scrollbars) stay dark regardless.

3. **Electron nativeTheme sync** — Electron's `nativeTheme` is separate from the DOM and ignores CSS classes. But `<html>` is as close as the renderer can get to the window root. If `nativeTheme.themeSource = "light"` is ever added for titlebar sync, the CSS class should be on the same logical root. `<body>` and `#root` are one indirection too deep.

**Implementation:** Toggle `document.documentElement.classList.toggle("light")` in JS. No CSP implications — class mutation is DOM, not script evaluation.

### Why dim opacity is higher in light mode

Dark backgrounds amplify low-opacity color overlays because you're adding luminance to near-black. Light backgrounds suppress them — there is almost no luminance delta to perceive.

Perceptual equivalence:

| Mode  | Background luminance | Overlay opacity | Perceived tint weight    |
| ----- | -------------------- | --------------- | ------------------------ |
| Dark  | ~2%                  | 10%             | Medium — clearly visible |
| Light | ~97%                 | 10%             | Nearly invisible         |
| Light | ~97%                 | 13–18%          | ~Equivalent to dark 10%  |

Yellow (`--color-warning`) has naturally low chroma contrast and needs the highest bump. Orange sits between yellow and red. The rule: **dark dims = 10–12%, light dims = 13–18%**.

### The inline style boundary rule

> **If the value requires a JavaScript expression to compute, it may be inline. If it is a static string, it must be a Tailwind class.**

```tsx
// WRONG — static strings belong in className
style={{ height: "100%", width: "100%", transformOrigin: "left center", transition: "transform 0.5s ease" }}

// RIGHT — split it
<div
  className="h-full w-full origin-left transition-transform duration-500 ease-in-out"
  style={{
    background: color,                           // prop → inline
    borderRadius: h,                             // prop → inline
    transform: `scaleX(${Math.min(v/max, 1)})`, // expression → inline
  }}
/>
```

Static props that always go to className (non-exhaustive): `display`, `flexDirection`, `alignItems`, `justifyContent`, `gap`, `padding`, `margin`, `width` (when `"100%"` or fixed string), `height` (same), `overflow`, `position`, `transformOrigin`, `transition`, `borderRadius` (when static), `fontFamily`, `fontSize` (when static), `fontWeight` (when static), `letterSpacing`, `whiteSpace`, `cursor`, `userSelect`, `pointerEvents`, `opacity` (when static).

Properties that may stay inline when dynamic: `color`, `background`, `borderColor`, `width`, `height`, `transform`, `opacity`, `top`/`left`/`right`/`bottom`, `zIndex` (when computed).

### `S.*` pattern in DevPanel

DevPanel consolidates styles into a top-level `const S = { ... }` object with ~50 named style constants. Process per entry:

- **100% static properties** → delete from `S`, replace call sites with a `className` string or `cn(...)` call
- **Mixed static + dynamic** → keep as style object; extract static props to a paired `className`, replace color props with `var(--color-*)`, leave computed props untouched
- **100% dynamic** → keep as-is, no changes

---

## 4. Research Summary

**Tailwind semantic token patterns**

Tailwind v3+ supports CSS var references via `tailwind.config.js` color extensions. The established pattern: define semantic vars in `:root` and `.light`, extend Tailwind's color scale to reference them, use `text-success`, `bg-error-dim` in className. This is exactly how shadcn/ui achieves its theming. The only gap in Exva is the missing semantic status color tokens.

Sources:

- https://tailwindcss.com/docs/customizing-colors
- https://ui.shadcn.com/docs/theming

**Light mode with CSS variables**

Dark is the default (`:root`), light is an override class (`.light` on `<html>`). A single class toggle switches the entire theme with no JS render involvement. Tailwind's `darkMode: ["class"]` (already configured in Exva) expects this pattern — it generates ancestor-class-scoped selectors. The existing `.dark` block in `styles.css` that duplicates `:root` is dead weight and will be removed.

Sources:

- https://tailwindcss.com/docs/dark-mode
- https://www.radix-ui.com/colors

**Inline style migration patterns**

The primary risk when migrating 823 inline style blocks is touching a dynamic value by mistake. The safe rule: classify each property in each `style={{}}` object as static (string literal) or dynamic (contains a JS variable, ternary, or template literal expression). Static → Tailwind class. Dynamic → stays inline, but color values are replaced with `var(--color-*)` tokens. Never touch properties that contain expressions.

---

## 5. Options Considered

**Option A: Status quo — do nothing**

| Dimension     | Assessment                         |
| ------------- | ---------------------------------- |
| Complexity    | Zero                               |
| Cost          | ~0 now, 5–10× later                |
| Reversibility | Always reversible                  |
| Risk          | Compounds with every AI agent edit |

---

**Option B: Color tokens only — replace hex with `var(--color-*)` in existing inline styles**

Add semantic CSS vars, replace all 247 hex values. Keep inline style blocks unchanged for layout. Skip Tailwind extension and light mode.

| Dimension  | Assessment                                                                   |
| ---------- | ---------------------------------------------------------------------------- |
| Complexity | Low                                                                          |
| Cost       | ~1–2 days                                                                    |
| Risk       | Doesn't fix AI agent drift — next edit adds hex again. No enforced boundary. |
| Light mode | Not enabled                                                                  |

---

**Option C: Full migration — semantic tokens + light mode + Tailwind-first + lint rule (Recommended)**

1. Define canonical semantic color tokens in `styles.css` with `:root` (dark) and `.light` (`<html>`) overrides
2. Extend `tailwind.config.js` with all semantic tokens
3. Replace all 247 hex values app-wide with Tailwind classes or `var(--color-*)` references
4. Migrate all static-value inline style props to Tailwind `className`
5. ESLint rule enforces the boundary going forward; CI fails on violation

| Dimension     | Assessment                                             |
| ------------- | ------------------------------------------------------ |
| Complexity    | Medium-high — requires judgment per inline style block |
| Cost          | ~5–7 days                                              |
| Reversibility | High — phased, each phase independently committable    |
| Risk          | DevPanel size; missed dynamic values                   |
| Light mode    | Fully supported at end                                 |
| Stack fit     | Excellent — aligns with existing shadcn/ui pattern     |

---

## 6. Recommendation

**Option C.**

Over Option B: Color tokens alone don't fix the AI agent drift problem — future code still reaches for inline styles and hex because there's no enforced boundary and no Tailwind tokens for status colors. The inline style migration and lint rule are what make the refactor durable.

Over Option A: Each AI agent edit compounds the inconsistency. A re-theme today is a 3-day grep; in 6 months it's a week.

Light mode cannot be done correctly without CSS vars. Doing the token work now means light mode is a `styles.css` edit forever after.

### Canonical color decisions

All open questions are resolved:

| Role              | Canonical dark value | Aliases collapsed                          | Canonical light value |
| ----------------- | -------------------- | ------------------------------------------ | --------------------- |
| `--color-success` | `#34d399`            | `#00e5a0`, `#6ee7b7`, `#86efac`            | `#059669`             |
| `--color-error`   | `#f87171`            | `#fca5a5`, `#fecaca`, `#ff4757`, `#ff7b8a` | `#dc2626`             |
| `--color-warning` | `#fbbf24`            | `#ffb733`, `#fcd34d`, `#fde68a`            | `#d97706`             |
| `--color-info`    | `#60a5fa`            | `#4da6ff`, `#93c5fd`                       | `#2563eb`             |
| `--color-market`  | `#a78bfa`            | `#c084fc`                                  | `#7c3aed`             |
| `--color-orange`  | `#fb923c`            | `#f97316`, `#fdba74`, `#ff8c42`            | `#ea580c`             |

Log level colors alias semantic tokens (no separate palette):

- `--color-log-debug`: `#374151` (distinct muted; no semantic alias)
- `--color-log-info`: `var(--color-info)`
- `--color-log-warn`: `var(--color-warning)`
- `--color-log-error`: `var(--color-error)`

Theme class placement: **`.light` on `<html>`**. Toggle via `document.documentElement.classList.toggle("light")`.

---

## 7. Implementation Plan

### Phase 1: Token system + light mode scaffold

**Goal:** All semantic tokens defined. Applying `.light` to `<html>` fully switches the theme. Zero component changes.

**Done criteria:**

- [ ] All semantic color CSS vars added to `:root` in `styles.css`
- [ ] `.light` block added to `styles.css` with all overrides (surfaces, text, borders, all `--color-*` vars)
- [ ] `--color-log-*` vars defined, aliasing semantic tokens via `var()`
- [ ] `--color-*-dim` and `--color-*-border` variants defined for all 6 roles (dark: 10–12% opacity; light: 13–18%)
- [ ] Existing `.dark` block removed from `styles.css` (it duplicates `:root` and is dead weight)
- [ ] `tailwind.config.js` extended with all semantic color keys (see below)
- [ ] Tailwind `darkMode` config left as `["class"]` — no change needed; `.light` override on `<html>` still works because `:root` is the dark default
- [ ] Manual smoke test: add `class="light"` to `<html>` in browser devtools → all surfaces and text flip correctly

**Exact token definitions to paste into `styles.css`:**

```css
/* =======================================================
   SEMANTIC COLOR TOKENS
   -------------------------------------------------------
   Edit ONLY this section to re-theme the entire app.
   Dark (default) values live in :root.
   Light overrides live in .light (applied to <html>).
   Toggle: document.documentElement.classList.toggle("light")
   =======================================================

   Dim variants  = tinted backgrounds for chips, badges, cards
   Border variants = outline color for tinted elements

   Dark mode dim opacity:  10–12%
   Light mode dim opacity: 13–18% (light backgrounds suppress
                           low-opacity overlays; bump to match
                           perceived weight)
   ======================================================= */

/* --- In :root, after existing vars --- */

/* Success: buy side, positive PnL, ok status, passing checks */
--color-success: #34d399;
--color-success-dim: rgba(52, 211, 153, 0.1);
--color-success-border: rgba(52, 211, 153, 0.25);

/* Error: sell side, negative PnL, error status, failed checks */
--color-error: #f87171;
--color-error-dim: rgba(248, 113, 113, 0.1);
--color-error-border: rgba(248, 113, 113, 0.25);

/* Warning: attention required, paused, caution states */
--color-warning: #fbbf24;
--color-warning-dim: rgba(251, 191, 36, 0.1);
--color-warning-border: rgba(251, 191, 36, 0.25);

/* Info: neutral signal, review phase, informational */
--color-info: #60a5fa;
--color-info-dim: rgba(96, 165, 250, 0.1);
--color-info-border: rgba(96, 165, 250, 0.25);

/* Market: market context phase, synthesis */
--color-market: #a78bfa;
--color-market-dim: rgba(167, 139, 250, 0.1);
--color-market-border: rgba(167, 139, 250, 0.25);

/* Orange: executing/running state, partial fill */
--color-orange: #fb923c;
--color-orange-dim: rgba(251, 146, 60, 0.12);
--color-orange-border: rgba(251, 146, 60, 0.35);

/* Log level colors — alias semantic tokens */
--color-log-debug: #374151;
--color-log-info: var(--color-info);
--color-log-warn: var(--color-warning);
--color-log-error: var(--color-error);
```

```css
/* --- .light block (replaces / removes the .dark block) --- */
.light {
  /* Surfaces */
  --bg: #f8fafc;
  --surface: #ffffff;
  --surface2: #f1f5f9;
  --surface3: #e2e8f0;
  --chip: #e2e8f0;
  --border: #cbd5e1;

  /* Text */
  --text1: #0f172a;
  --text2: #475569;
  --text3: #94a3b8;

  /* Accent */
  --accent: oklch(0.55 0.18 240);
  --accent-dim: rgba(59, 130, 246, 0.15);

  /* Shadcn / Tailwind mapped vars */
  --background: 210 40% 98%;
  --foreground: 222 47% 11%;
  --card: 0 0% 100%;
  --card-foreground: 222 47% 11%;
  --popover: 0 0% 100%;
  --popover-foreground: 222 47% 11%;
  --primary: 231 87% 60%;
  --primary-foreground: 0 0% 100%;
  --secondary: 210 40% 94%;
  --secondary-foreground: 222 47% 11%;
  --muted: 210 40% 94%;
  --muted-foreground: 215 16% 47%;
  --accent-hsl: 231 87% 60%;
  --accent-foreground: 0 0% 100%;
  --destructive: 0 84% 60%;
  --destructive-foreground: 0 0% 100%;
  --border-hsl: 214 32% 82%;
  --input-hsl: 214 32% 82%;
  --ring: 231 87% 60%;

  /* Semantic status colors — darker in light mode for contrast */
  --color-success: #059669;
  --color-success-dim: rgba(5, 150, 105, 0.13);
  --color-success-border: rgba(5, 150, 105, 0.3);

  --color-error: #dc2626;
  --color-error-dim: rgba(220, 38, 38, 0.12);
  --color-error-border: rgba(220, 38, 38, 0.28);

  --color-warning: #d97706;
  --color-warning-dim: rgba(
    217,
    119,
    6,
    0.18
  ); /* yellow: highest bump needed */
  --color-warning-border: rgba(217, 119, 6, 0.35);

  --color-info: #2563eb;
  --color-info-dim: rgba(37, 99, 235, 0.12);
  --color-info-border: rgba(37, 99, 235, 0.28);

  --color-market: #7c3aed;
  --color-market-dim: rgba(124, 58, 237, 0.12);
  --color-market-border: rgba(124, 58, 237, 0.28);

  --color-orange: #ea580c;
  --color-orange-dim: rgba(234, 88, 12, 0.14);
  --color-orange-border: rgba(234, 88, 12, 0.3);

  /* Log colors inherit from overridden semantic tokens — no changes needed */
}
```

**Exact additions to `tailwind.config.js`** (inside `theme.extend.colors`):

```js
success: {
  DEFAULT: "var(--color-success)",
  dim: "var(--color-success-dim)",
  border: "var(--color-success-border)",
},
error: {
  DEFAULT: "var(--color-error)",
  dim: "var(--color-error-dim)",
  border: "var(--color-error-border)",
},
warning: {
  DEFAULT: "var(--color-warning)",
  dim: "var(--color-warning-dim)",
  border: "var(--color-warning-border)",
},
info: {
  DEFAULT: "var(--color-info)",
  dim: "var(--color-info-dim)",
  border: "var(--color-info-border)",
},
market: {
  DEFAULT: "var(--color-market)",
  dim: "var(--color-market-dim)",
  border: "var(--color-market-border)",
},
"status-orange": {
  DEFAULT: "var(--color-orange)",
  dim: "var(--color-orange-dim)",
  border: "var(--color-orange-border)",
},
"log-debug": "var(--color-log-debug)",
"log-info":  "var(--color-log-info)",
"log-warn":  "var(--color-log-warn)",
"log-error": "var(--color-log-error)",
```

**Tailwind class reference** (use these in Phase 2 + 3):

| Intent                    | Tailwind class          |
| ------------------------- | ----------------------- |
| Success text              | `text-success`          |
| Success tinted background | `bg-success-dim`        |
| Success border            | `border-success-border` |
| Error text                | `text-error`            |
| Error tinted background   | `bg-error-dim`          |
| Error border              | `border-error-border`   |
| Warning text              | `text-warning`          |
| Warning tinted background | `bg-warning-dim`        |
| Info text                 | `text-info`             |
| Info tinted background    | `bg-info-dim`           |
| Market text               | `text-market`           |
| Orange/executing text     | `text-status-orange`    |
| Log debug text            | `text-log-debug`        |
| Log info text             | `text-log-info`         |
| Log warn text             | `text-log-warn`         |
| Log error text            | `text-log-error`        |

Dependencies: None.
Rollback: Revert `styles.css` and `tailwind.config.js`. Zero component impact.

---

### Phase 2: Replace hardcoded hex in non-DevPanel files

**Goal:** Zero hex literals in all files except `DevPanel.tsx`. Static inline style props migrated to Tailwind className.

**Classification rules per property in a `style={{}}` block:**

| Property type                   | Example                                  | Action                                                                            |
| ------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------- |
| Static string, maps to Tailwind | `height: "100%"`                         | → `h-full` in `className`                                                         |
| Static string, maps to Tailwind | `transition: "transform 0.5s ease"`      | → `transition-transform duration-500 ease-in-out`                                 |
| Static string, maps to Tailwind | `transformOrigin: "left center"`         | → `origin-left`                                                                   |
| Static string, maps to Tailwind | `display: "flex"`                        | → `flex`                                                                          |
| Static string, maps to Tailwind | `overflow: "hidden"`                     | → `overflow-hidden`                                                               |
| Static string, maps to Tailwind | `cursor: "pointer"`                      | → `cursor-pointer`                                                                |
| Dynamic color prop              | `color: isError ? "#f87171" : "#34d399"` | → `color: isError ? "var(--color-error)" : "var(--color-success)"` (stays inline) |
| Dynamic color, can be className | `color: "#34d399"` on a static element   | → `text-success` in `className`, remove from `style`                              |
| Dynamic computed                | `` transform: `scaleX(${v/max})` ``      | → stays inline, untouched                                                         |
| Dynamic prop                    | `width: pct`                             | → stays inline, untouched                                                         |

**Worked example:**

```tsx
// BEFORE
<div style={{
  height: "100%",
  width: "100%",
  background: color,
  borderRadius: h,
  transform: `scaleX(${Math.min(value / max, 1)})`,
  transformOrigin: "left center",
  transition: "transform 0.5s ease",
}} />

// AFTER
<div
  className="h-full w-full origin-left transition-transform duration-500 ease-in-out"
  style={{
    background: color,      // dynamic prop — stays inline
    borderRadius: h,        // dynamic prop — stays inline
    transform: `scaleX(${Math.min(value / max, 1)})`,  // expression — stays inline
  }}
/>
```

**Done criteria:**

- [ ] Zero hex color literals in all `src/` files except `DevPanel.tsx`
- [ ] All static layout props converted to Tailwind in all migrated files
- [ ] Color props on static elements use Tailwind tokens (`text-error`, `bg-success-dim`, `border-warning-border`)
- [ ] Color props in remaining `style={{}}` blocks use `var(--color-*)` references
- [ ] After each file: run `grep -n '#[0-9a-fA-F]' <file>` → expect 0 results
- [ ] Visual spot-check after each file in the running app

**File order (most hex first, highest visibility first):**

1. **`TopNav.tsx`** — 8 session status configs each with `dot`, `bg`, `border` colors; environment mode badge; 3 alert banner variants. All status color maps become objects of `var(--color-*)` strings.
2. **`AutopsyPage.tsx`** — phase color maps (`thesis`, `execution`, `behavioral`, `market_context`, `synthesis`), PnL sign colors, entry timing map, position sizing map, severity map, market conditions map. Maps become `var(--color-*)` or Tailwind token objects.
3. **`Dashboard.tsx`** — PnL sign colors, log level color map (`DEBUG`/`INFO`/`WARN`/`ERROR`), session state colors, meter bar threshold color.
4. **`AccountsPage.tsx`** — ok/error dot pattern repeated ~6 times for broker/provider status; connection test result color.
5. **`SessionTable.tsx`** — error/warning/orange alert color chains.
6. **`SessionExecutionProgress.tsx`** — phase step colors (warn, info, error, orange).
7. **`SessionDetailDrawer.tsx`** — error log level color, error banner.
8. **`TradeDetail.tsx`** — PnL sign colors, phase bar colors with dim backgrounds.
9. **`TradesPage.tsx`** — PnL sign, chart phase colors.
10. **`LessonsPanel.tsx`** — lesson status map, importance dot map.
11. **`ChatHistoryModal.tsx`** — phase color map, error states.
12. **`RuntimeEventToast.tsx`** — error/info/warning border, background, icon color ternaries.
13. **`App.tsx`** — error banner border + background.
14. **`BrokersPage.tsx`** — connection status dot.
15. **`CostBreakdown.tsx`** — cost meter threshold color, phase bar colors.
16. **`StrategyConfig.tsx`** — validation warning/error colors.
17. **`components/accounts/AddAiProviderModal.tsx`**, **`AddBrokerModal.tsx`**, **`AddSearchProviderModal.tsx`** — test result colors.
18. **`components/approvals/ApprovalDetailModal.tsx`**, **`PendingApprovalsPanel.tsx`** — warning/error states.
19. **`components/strategy/TimeframeHorizonCard.tsx`**, **`AiPhasesSection.tsx`**, **`GlobalPresetComponents.tsx`**, **`ProviderModelPicker.tsx`** — misc color props.
20. **`components/custom-ui/index.tsx`** — `Dot` component default color prop.
21. **`components/sessions/CreateEditSessionModal.tsx`**, **`LiveReadinessModal.tsx`**, **`SessionTemplatesModal.tsx`** — validation/readiness colors.
22. **`components/strategy/CostSummaryCard.tsx`** — cost threshold.
23. **`pages/DevPanel.tsx`** — deferred to Phase 3.

Dependencies: Phase 1 complete.
Rollback: Each file is an independent commit. Revert individual files as needed.

---

### Phase 3: DevPanel full migration

**Goal:** `DevPanel.tsx` migrated to tokens + Tailwind. `S.*` object reduced to only entries containing dynamic values.

**Process:**

1. Audit the `S` object top to bottom. For each named entry, list every property and classify it (static string / dynamic).
2. **100% static entries** — delete from `S`. Replace every call site `S.entryName` with an inline `cn("class1 class2 ...")` or extract as a `const cls = "..."` string above the component.
3. **Mixed entries** — keep as a `style` object. Move every static property to a paired `className` string. Replace color values with `var(--color-*)`. Leave computed values as-is.
4. **100% dynamic entries** — keep as-is. No changes.
5. Color maps in `S` (`logColors`, agent/phase color maps) — convert to objects of `var(--color-*)` string values instead of raw hex.

**Done criteria:**

- [ ] Zero hex literals in `DevPanel.tsx`
- [ ] Every 100%-static `S.*` entry deleted from the `S` object and replaced with className
- [ ] Log level color map uses `var(--color-log-*)` tokens
- [ ] Phase/agent color map uses `var(--color-*)` tokens
- [ ] `S` object contains only entries that have at least one dynamic property
- [ ] Visual spot-check: log viewer, run cards, run inspector, debug capture panel, diagnostic panel, live feed panel

**Sub-commit strategy** (do not commit DevPanel as one giant diff):

- Commit 1: `S` object static entries → className (no color changes yet)
- Commit 2: Color maps and `var(--color-*)` replacements
- Commit 3: Remaining hex in inline JSX style props

Dependencies: Phase 2 complete.
Rollback: Three sub-commits mean three independent revert points.

---

### Phase 4: Lint enforcement

**Goal:** The refactor cannot regress. Hex color literals and static inline styles are mechanically rejected.

**Done criteria:**

- [ ] ESLint rule 1: no raw hex color literals in `.tsx`/`.ts` files. Implemented via `no-restricted-syntax` targeting string literals matching `/^#[0-9a-fA-F]{3,6}$/`. Error message: `"Use a CSS var token from styles.css or a Tailwind semantic class. See THEMING.md."`
- [ ] ESLint rule 2: `style` prop objects may not contain properties with static string values that have a direct Tailwind equivalent. Target at minimum: `height`, `width`, `display`, `flexDirection`, `alignItems`, `justifyContent`, `gap`, `padding`, `margin`, `overflow`, `cursor`, `transition`, `transformOrigin`, `fontFamily`, `whiteSpace`, `userSelect`, `pointerEvents`.
- [ ] Both rules added to `.eslintrc` (or `eslint.config.js`) in the `rules` block
- [ ] CI step runs `eslint src/` — build fails on violation
- [ ] `THEMING.md` created at repo root with:
  - Full token catalog (all `--color-*` vars with their semantic meaning)
  - The inline style boundary rule (verbatim from Section 3 of this doc)
  - Light mode toggle: `document.documentElement.classList.toggle("light")`
  - Tailwind class reference table (from Phase 1 above)
  - What to do when you need a color not in the token set (add it to `styles.css` first, then extend `tailwind.config.js`)

Dependencies: Phase 3 complete.
Rollback: Remove lint rules — zero runtime impact.

---

## 8. Risk Register

| #   | Risk                                                                                               | Likelihood | Impact | Mitigation                                                                                                                                                              |
| --- | -------------------------------------------------------------------------------------------------- | ---------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Alias consolidation causes subtle visual regression (one green is slightly different from another) | Medium     | Low    | Screenshot key screens before Phase 2 starts; spot-check PnL numbers, status dots, toast colors after each file                                                         |
| 2   | DevPanel style logic is deeply nested — missed dynamic value breaks layout                         | Medium     | Medium | Phase 3 last; three sub-commits for independent revert points; visual spot-check of all DevPanel panels after each sub-commit                                           |
| 3   | Tailwind purges new semantic color classes (class name never appears as a static string in source) | Low        | Medium | During migration, add a temporary `safelist` in `tailwind.config.js` covering new token patterns; verify classes appear in built CSS; remove safelist after             |
| 4   | Light mode colors have poor contrast on some components                                            | Medium     | Low    | Light mode scaffold is not surfaced to users until a UI toggle is built (non-goal); validate with browser devtools class toggle before shipping the toggle              |
| 5   | Scope creep — non-color inline style migration breaks something                                    | Medium     | Medium | Strict rule: only convert properties that are static string literals with a direct Tailwind equivalent. Never touch any property containing a JS variable or expression |
| 6   | AI agent edit during migration reintroduces hex in a mid-refactor file                             | Medium     | Low    | Phase 4 lint rule; keep Phase 2 commits fast and file-by-file to minimize the window                                                                                    |

---

## 9. Success Criteria

| Goal                   | Metric                                 | Baseline              | Target                                     | How Measured                                              |
| ---------------------- | -------------------------------------- | --------------------- | ------------------------------------------ | --------------------------------------------------------- |
| No raw hex             | Hex literals in `src/`                 | 247                   | 0                                          | `grep -rP '#[0-9a-fA-F]{3,6}' src/` returns empty         |
| Token coverage         | Semantic color vars in `styles.css`    | 4 (partial)           | 24 (6 roles × 3 variants + 4 log)          | Count vars in styles.css                                  |
| Inline style reduction | `style={{}}` blocks in `src/`          | 823                   | <200 (dynamic-only remain)                 | `grep -rc 'style={{' src/`                                |
| Light mode works       | `.light` on `<html>` renders correctly | N/A                   | All surfaces, text, and status colors flip | Manual toggle in devtools                                 |
| No visual regression   | App appearance                         | Baseline (screenshot) | Identical                                  | Side-by-side screenshot comparison                        |
| Lint enforced          | CI on PR containing a raw hex literal  | N/A                   | CI fails                                   | Introduce a test hex literal in a branch, verify CI fails |

---

## 10. Open Questions

All questions resolved:

| #   | Question                                         | Resolution                                                                                                                                                            |
| --- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | DevPanel `#00e5a0` vs `#34d399` — intentional?   | Collapsed to `--color-success` (`#34d399`). Same token everywhere.                                                                                                    |
| 2   | Log colors — separate palette or alias semantic? | Alias semantic tokens. `--color-log-error = var(--color-error)`. No separate palette.                                                                                 |
| 3   | Light mode planned?                              | Yes — in scope. Phase 1 includes full `.light` token override block.                                                                                                  |
| 4   | Which element gets `.light`?                     | `<html>`. Reasons: Tailwind ancestor selector scope, scrollbar theming, Electron nativeTheme proximity. Toggle: `document.documentElement.classList.toggle("light")`. |
| 5   | Light mode dim opacity — same 10% or higher?     | Higher. Dark 10%, light 13–18%. Yellow/orange need the highest bump (warm hues fade fastest on light backgrounds). Exact values in Phase 1 token definitions.         |

---

## 11. Alternatives Rejected

| Option                                        | Why Rejected                                                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| CSS-in-JS (styled-components, emotion)        | Runtime dep; project is already on Tailwind + CSS vars which is the correct pattern                                                        |
| CSS Modules per component                     | Overkill; `:root` vars at the document level are simpler and already present                                                               |
| Automated codemod only                        | Can replace hex → var but cannot judge static vs dynamic, pick canonical aliases, or make semantic naming decisions                        |
| Tailwind `dark:` variants instead of CSS vars | Requires duplicating every color utility with `dark:` prefix across all files; CSS vars at `:root` / `.light` handle it in one place       |
| Keep inline styles, just token the colors     | Doesn't fix AI agent drift — no enforced boundary; next edit reaches for hex again                                                         |
| `.light` on `<body>` or `#root`               | Breaks scrollbar theming outside that subtree; Radix portals teleport outside `#root`; wrong level for Tailwind's ancestor-class selectors |
