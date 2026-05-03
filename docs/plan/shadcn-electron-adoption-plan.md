# Exva shadcn/ui Adoption in Electron — Plan

> **Date:** 2026-05-03  
> **Last updated:** 2026-05-03  
> **Status:** Active (Phase 0 complete; Phase 1–3 in flight)  
> **Deciders:** Exva frontend owner, desktop app owner, design/theme owner

## 1. Problem Statement

Exva's renderer UI is currently built mostly with inline styles and custom atoms (`src/components/atoms.tsx`) on top of root CSS variables (`src/styles.css`), which keeps visual control but slows down feature delivery because every new screen or interaction needs custom styling and repeated component work. The app now has multiple product surfaces (Dashboard, Sessions, Strategy, Trades, Accounts), and each surface increasingly needs consistent controls (dialogs, menus, tables, inputs, badges, tabs, selectors) that are expensive to hand-roll and maintain. We need a faster UI delivery model that still preserves Exva's existing look and theme tokens rather than replacing brand identity with defaults. If we do nothing, UI development velocity stays constrained by CSS and bespoke component churn, and consistency debt will grow as more screens are added.

## 2. Goals & Non-Goals

**Goals**


| #   | Goal                                                                                | Success Looks Like                                                                            |
| --- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| G1  | Fully replace current custom renderer UI primitives with shadcn/ui-based components | Legacy custom atoms and inline-style primitives are removed from active use                   |
| G2  | Preserve Exva visual identity                                                       | Existing color, spacing, typography, and interaction tone remain recognizable after migration |
| G3  | Reduce custom CSS and inline-style churn                                            | Significant share of reused controls comes from shared shadcn-based primitives                |
| G4  | Keep Electron compatibility and security posture                                    | No regression in preload/IPC boundaries or renderer hardening                                 |


**Non-Goals**


| #   | Non-Goal                                      | Reason                                                                         |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------ |
| NG1 | Keep a permanent hybrid of old atoms + shadcn | The project decision is full replacement, not dual-system maintenance          |
| NG2 | Introduce a full visual redesign              | Objective is velocity + consistency while keeping the existing theme direction |
| NG3 | Change Electron process architecture          | This plan is renderer UI-layer focused, not main-process/runtime redesign      |


## 3. Background & Context

Exva is an Electron Forge + Vite + React + TypeScript app (`package.json`) with renderer code under `src/`. Historically, styling was anchored in CSS custom properties (`--bg`, `--surface`, `--text1`, etc.) in `src/styles.css`, with many UI blocks inline-styled in page components and shared atoms.

**Current state (post–Phase 0 bootstrap):**

- **Tailwind CSS** is wired for the renderer: `tailwind.config.js`, `postcss.config.js`, `@tailwind` layers in `src/styles.css`, and content globs over `./index.html` and `./src/**/*.{ts,tsx}`.
- **shadcn-style primitives** live under `src/components/ui/` (Button, Input, Card, Dialog, DropdownMenu, Table, Badge, Tabs, Select, Tooltip, Separator, etc.), driven by `components.json` and the `@/*` path alias in `vite.renderer.config.ts`.
- **Semantic HSL tokens** for shadcn (`--background`, `--foreground`, `--card`, …) are defined alongside **legacy hex/oklch tokens** (`--bg`, `--surface`, `--text1`, …). Tailwind color utilities map to the HSL semantic set. During Phase 1, consolidate naming and values so there is a single authoritative palette (see [§13](#13-appendix-token-bridge-reference) and risk R6).
- `**src/lib/utils.ts`** exposes `cn()` for `clsx` + `tailwind-merge`.
- `**docs/shadcn-usage-guide.md**` documents team conventions for new UI work.
- `**src/components/atoms.tsx**` wraps shadcn for `Badge`, `Card`, and `Divider` (via `Separator`); `Dot`, `PageShell`, `SectionTitle`, and `LevelDot` remain inline-style oriented. Most feature code still imports from `@/components/atoms` or uses hand-rolled modal/panel styles rather than importing `@/components/ui` directly—expected until Phases 2–3.

Key constraints:

- Exva's dark, high-contrast desktop look should remain stable during migration.
- The app is local-rendered in Electron; UI framework changes must not weaken existing security boundaries around IPC/preload.
- Favor composable primitives that reduce per-page CSS decisions; end state is **no new** legacy patterns ([§15](#15-appendix-verification-commands-and-pr-checklist)).

## 4. Research Summary

**shadcn/ui architecture and workflow**

- shadcn/ui is an open-code distribution model, not a sealed component package. Teams copy component source into their repo and customize it directly, which aligns well with Exva's need to preserve visual identity while accelerating delivery.
- The model emphasizes composable primitives and a shared interface, which reduces component API drift and makes future internal standardization easier.
- Key insight: this is a strong fit for "use wherever possible" because it avoids lock-in and supports local modifications when trading/desktop-specific behaviors need tweaks.
- Sources:
  - [https://ui.shadcn.com/docs](https://ui.shadcn.com/docs)
  - [https://github.com/shadcn-ui/ui](https://github.com/shadcn-ui/ui)

**shadcn theming via semantic tokens**

- shadcn recommends CSS variable-driven semantic tokens (`background`, `foreground`, `card`, `border`, `primary`, etc.) and maps them into Tailwind utilities.
- This lets a team preserve an existing theme by remapping current tokens instead of forcing default palettes.
- Key insight: Exva bridges legacy variables (`--bg`, `--surface`*, `--text*`, `--accent`) to shadcn semantic token names in `src/styles.css`; finish the bridge by deduplicating overlaps and validating utilities like `border-border`.
- Sources:
  - [https://ui.shadcn.com/docs/theming](https://ui.shadcn.com/docs/theming)
  - [https://ui.shadcn.com/docs/installation](https://ui.shadcn.com/docs/installation)

**Electron security constraints during UI modernization**

- Electron recommends strict renderer hardening (context isolation, secure content, IPC sender validation, no unsafe remote integrations).
- UI-library adoption is renderer-focused, but onboarding new dependencies and patterns still requires guardrails so no component-level pattern accidentally bypasses security assumptions.
- Key insight: migration checklist should explicitly include "no new preload surface" and "no unsafe external content patterns" to avoid accidental scope creep from UI changes.
- Sources:
  - [https://www.electronjs.org/docs/latest/tutorial/security](https://www.electronjs.org/docs/latest/tutorial/security)

## 5. Decided Direction (No Alternatives)

Project decision: **completely replace the current custom renderer UI layer with shadcn/ui-based components**.

Scope of replacement:

- Replace custom atoms and repeated inline-style primitives in `src/components/atoms.tsx` and page-level UI blocks.
- Standardize on `src/components/ui/`* as the component foundation.
- Keep Exva's visual identity by mapping existing theme tokens into shadcn semantic tokens.

Boundary conditions:

- Migration is still phased for execution safety, but the end state is not hybrid.
- New renderer UI work during migration must be built on shadcn primitives to avoid adding more legacy surface.

## 6. Recommendation

**Execute full replacement: migrate all renderer UI to shadcn-based components and retire legacy custom atoms.**

The migration sequence is phased only to reduce breakage risk and keep the app runnable between steps. The target remains complete replacement, with no permanent split system.

## 7. Implementation Plan

**Phase 0: Foundation setup (Tailwind + shadcn bootstrap)**

Goal: establish tooling and shared primitives without changing product behavior, as the base for full replacement.

Done criteria:

- Tailwind configured in renderer build.
- shadcn initialized and baseline utility files added (`cn` helper, component registry setup).
- Initial core components added (Button, Input, Card, Dialog, DropdownMenu, Table, Badge, Tabs, Select, Tooltip).

Deliverables:

- Tailwind config and CSS entry integration for `src/`
- `components.json` with CSS variables enabled
- `src/components/ui/`* baseline primitives
- UI usage guide doc in `docs/` for Exva conventions (`docs/shadcn-usage-guide.md`)

Dependencies: none.

Risks and detection:

- Risk: build/tooling mismatch in Electron renderer.
- Detect via: `npm run typecheck`, `npm run lint`, `npm run build`, manual renderer smoke test.

Rollback plan:

- Revert only the setup commit if bootstrap fails; otherwise continue with forward-only replacement.

---

**Phase 1: Theme bridge and visual parity layer**

Goal: preserve Exva look while enabling shadcn semantics for complete migration coverage.

Done criteria:

- Exva current theme variables mapped to shadcn token set **without conflicting duplicate custom properties** (one source of truth per logical token).
- Typography/radius/spacing defaults aligned to current UI tone.
- Visual parity checklist passes for baseline controls (Button, Input, Card, Dialog, Table row, Badge, Tabs, Select, Tooltip).

Deliverables:

- Single coherent token story in `src/styles.css` (or split `src/theme.css` imported first if preferred)
- Mapping reference: [§13](#13-appendix-token-bridge-reference) in this plan (extend if tokens move to a dedicated file)
- Baseline snapshot comparisons for core controls (manual first; optional CI in Phase 3 per [§10](#10-open-questions--decisions))

Dependencies: Phase 0.

Risks and detection:

- Risk: accidental drift in contrast/accessibility; **risk: duplicate `--`* names** where later declarations override shadcn HSL components and break `hsl(var(--token))` in Tailwind.
- Detect via: side-by-side screenshot diff, manual contrast review, and quick audit of `:root` / `.dark` for duplicate variable names.

Rollback plan:

- Revert token mapping changes only if visual parity fails; continue migration after token correction.

---

**Phase 2: Core primitive replacement**

Goal: replace all shared primitives and remove legacy atom usage from active renderer paths.

Done criteria:

- Legacy atoms in `src/components/atoms.tsx` are removed or reduced to thin re-exports only where a stable public API is still needed temporarily—**no** long-term pass-through layer.
- Shared controls (buttons, cards, badges, dialogs, dropdowns, tables, form controls) are shadcn-based everywhere they appear; modals/drawers use `Dialog` (and sheet-style patterns where appropriate) instead of ad hoc `position: fixed` overlay objects where feasible.

Deliverables:

- `Dot`, `PageShell`, `SectionTitle`, `LevelDot`, and any remaining inline-only primitives migrated or replaced by layout/components using `className` + ui primitives (`Badge` / `Card` / `Divider` already wrap shadcn)
- Feature components import `@/components/ui/`* (or small local wrappers) directly; `atoms.tsx` deleted or stripped to zero
- Parity notes for each migrated primitive family (can live in PR descriptions until stable)

Dependencies: Phase 1.

Risks and detection:

- Risk: inconsistent style usage during mixed-state migration.
- Detect via: PR checklist requiring shadcn-first justification for new UI ([§15](#15-appendix-verification-commands-and-pr-checklist)).

Rollback plan:

- Revert only failing primitive migrations; keep completed primitives in place.

---

**Phase 3: Page-by-page full replacement completion**

Goal: finish migration across all renderer pages and remove remaining legacy inline-style UI.

Done criteria:

- `Dashboard`, `Sessions`, `Strategy`, `Trades`, `Accounts`, `CostBreakdown`, `DevPanel`, `TradeDetail`, and related modals/drawers use shadcn-based UI composition.
- Legacy inline-style-only layout/control patterns are removed except minimal shell layout wiring if truly necessary.
- PR template includes mandatory check: no new legacy UI patterns introduced.

Deliverables:

- Migration matrix at 100%: [§14](#14-appendix-page-and-surface-migration-matrix)
- PR checklist and reviewer rubric update ([§15](#15-appendix-verification-commands-and-pr-checklist))
- Final cleanup PR removing dead legacy UI code

Dependencies: Phase 2.

Risks and detection:

- Risk: migration stalls and legacy atoms persist indefinitely.
- Detect via: monthly UI debt report (grep for `atoms`, large inline `style={{` blocks in `src/pages` and `src/components`).

Rollback plan:

- Revert only the last unstable page migration; continue toward full replacement after fixes.

## 8. Risk Register


| #   | Risk                                                         | Likelihood | Impact | Mitigation                                                                                      |
| --- | ------------------------------------------------------------ | ---------- | ------ | ----------------------------------------------------------------------------------------------- |
| R1  | Theme drift from current Exva look                           | Medium     | High   | Token bridge first, visual parity checklist before broad rollout                                |
| R2  | Temporary two-system inconsistency during migration          | High       | Medium | Aggressive page-by-page completion plan + no new legacy UI rule                                 |
| R3  | Tailwind/shadcn setup friction in Electron toolchain         | Low        | Medium | Phase 0 landed with full build/test smoke; re-run when upgrading Electron or Vite               |
| R4  | Accessibility regressions in custom overrides                | Medium     | Medium | Prefer stock shadcn patterns; test focus/contrast in migrated flows                             |
| R5  | Migration stalls before full replacement is complete         | Medium     | High   | Track per-page completion to 100% and block net-new legacy UI                                   |
| R6  | CSS variable collisions between legacy and HSL semantic sets | Medium     | High   | Phase 1 audit: one definition per token; document in [§13](#13-appendix-token-bridge-reference) |


## 9. Success Criteria


| Goal | Metric                                              | Baseline                                              | Target                                  | How Measured                                                              |
| ---- | --------------------------------------------------- | ----------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------- |
| G1   | Renderer pages fully migrated to shadcn-based UI    | Partial (atoms wrap ui; pages mostly legacy patterns) | 100% by migration completion            | [§14 matrix](#14-appendix-page-and-surface-migration-matrix) + code audit |
| G2   | Core page visual parity issues after migration      | Unknown                                               | <=3 medium issues per migrated page     | QA/design review log                                                      |
| G3   | Legacy inline style blocks for reusable UI controls | High (current default pattern)                        | >=90% reduction by migration completion | Static grep + PR stats                                                    |
| G4   | Build/type/lint pass rate during migration          | Current CI pass baseline                              | No regression from baseline             | CI history                                                                |


Leading indicators:

- First migration tranche lands with no severe regressions.
- Reviewers consistently enforce shadcn-first rule.

Lagging indicators:

- Faster delivery time for UI-heavy features.
- Lower maintenance edits per component family over time.

## 10. Open Questions & Decisions


| #   | Question                                                                   | Owner          | Decision / recommendation                                                                                                                                                                                                                                                                                                                                                                                         | Status                                  |
| --- | -------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Q1  | What is the exact page migration order for fastest end-to-end replacement? | Frontend owner | **Order:** (1) `SessionsPage` + session modals, templates modal, `SessionTable`, `SessionDetailDrawer`; (2) `AccountsPage` + `AddBrokerModal`, `AddAiProviderModal`; (3) `TradesPage` + `TradeDetail`; (4) `StrategyConfig` + `components/strategy/`*; (5) `Dashboard`; (6) `CostBreakdown`; (7) `DevPanel`. Rationale: sessions and accounts stress tables and dialogs early; adjust if product priority shifts. | **Decided**                             |
| Q2  | Add visual regression snapshots in CI now or defer?                        | App owner      | **Defer automated snapshots until Phase 3** unless a low-flake harness is quick to add; until then use manual side-by-side review and optional Playwright screenshot smoke on one golden path. Revisit when roughly half of surfaces in [§14](#14-appendix-page-and-surface-migration-matrix) are complete.                                                                                                       | **Decided**                             |
| Q3  | What date or milestone gates 100% replacement?                             | App owner      | Owners pick a **release or version target**; until then each renderer PR follows **Definition of Done**: no new `atoms` exports; no new large inline modal shells—use ui primitives. Release hard gate: all rows in [§14](#14-appendix-page-and-surface-migration-matrix) marked complete.                                                                                                                        | **Process decided** (calendar date TBD) |


## 11. Alternatives Rejected

Alternatives are intentionally not carried forward. Team decision is full replacement of the current custom UI layer with shadcn-based components.

## 12. Execution status snapshot

Update this table in the same PR when a phase materially changes.


| Phase | Status          | Notes                                                                                           |
| ----- | --------------- | ----------------------------------------------------------------------------------------------- |
| 0     | **Complete**    | Tailwind, PostCSS, `components.json`, `src/components/ui/`*, `cn`, `docs/shadcn-usage-guide.md` |
| 1     | **In progress** | HSL semantic vars and legacy vars coexist; deduplicate and run parity checklist                 |
| 2     | **Not started** | Atoms still export mixed primitives; feature files rarely import `@/components/ui` directly     |
| 3     | **Not started** | Many modals still use inline overlay/panel styles                                               |


**Suggested next engineering tasks**

1. Finish Phase 1 token audit in `src/styles.css` and resolve duplicate or shadowed variables so Tailwind `hsl(var(--token))` colors stay valid.
2. Migrate one representative modal (for example session create/edit) to `Dialog` + `Button` + `Input` as the pattern for the rest.
3. Replace `PageShell` and `SectionTitle` with class-based layout or small shared layout components using semantic utilities.
4. Remove `@/components/atoms` imports file by file, then delete or empty `atoms.tsx`.

## 13. Appendix: Token bridge reference

shadcn and Tailwind in this repo expect **space-separated HSL components** (no `hsl()` wrapper) for variables consumed as `hsl(var(--name))`. Legacy Exva variables use **hex** or **oklch**. Intended mapping:


| Exva (legacy)                           | Role                   | shadcn semantic (Tailwind)            | Notes                                                                |
| --------------------------------------- | ---------------------- | ------------------------------------- | -------------------------------------------------------------------- |
| `--bg`                                  | App chrome background  | `--background` → `bg-background`      | Align until `html, body` can use semantic utilities only             |
| `--surface`, `--surface2`, `--surface3` | Elevated panels / rows | `--card`, `--muted`, extras as needed | Add tokens or utilities if a shade has no semantic twin              |
| `--text1`                               | Primary text           | `--foreground`                        |                                                                      |
| `--text2`                               | Secondary text         | `--muted-foreground`                  |                                                                      |
| `--text3`                               | Tertiary / labels      | muted + opacity or extended token     |                                                                      |
| `--accent` (legacy)                     | Brand accent           | `--primary`, `--accent`, `--ring`     | Keep focus ring visible on dark chrome                               |
| `--border` (legacy)                     | Hairlines              | `--border`, `--input`                 | Avoid two different `--border` assignments in the same cascade scope |


After consolidation, standardize new components on semantic utilities (`bg-card`, `text-foreground`, …) and treat legacy names as transitional only.

## 14. Appendix: Page and surface migration matrix


| Surface        | Primary files                                             | Legacy / atoms today | Target                      | Status |
| -------------- | --------------------------------------------------------- | -------------------- | --------------------------- | ------ |
| Dashboard      | `pages/Dashboard.tsx`                                     | atoms                | Card, layout, data chrome   | ⬜      |
| Sessions       | `pages/SessionsPage.tsx`                                  | atoms                | layout, Table, Button       | ⬜      |
| Session table  | `components/sessions/SessionTable.tsx`                    | atoms                | Table, Badge                | ⬜      |
| Session modals | `CreateEditSessionModal.tsx`, `SessionTemplatesModal.tsx` | inline modal         | Dialog, Form, Input, Select | ⬜      |
| Session drawer | `SessionDetailDrawer.tsx`                                 | atoms                | drawer/sheet pattern, Tabs  | ⬜      |
| Trades         | `pages/TradesPage.tsx`                                    | atoms                | Table, Badge, filters       | ⬜      |
| Trade detail   | `pages/TradeDetail.tsx`                                   | atoms                | Card, typography            | ⬜      |
| Strategy       | `pages/StrategyConfig.tsx`, `components/strategy/`*       | atoms                | Card, Tabs, Input           | ⬜      |
| Cost breakdown | `pages/CostBreakdown.tsx`                                 | atoms                | Card                        | ⬜      |
| Accounts       | `pages/AccountsPage.tsx`                                  | atoms                | Card, lists                 | ⬜      |
| Account modals | `AddBrokerModal.tsx`, `AddAiProviderModal.tsx`            | inline               | Dialog, Input, Select       | ⬜      |
| Approvals      | `PendingApprovalsPanel.tsx`, `ApprovalDetailModal.tsx`    | atoms / inline       | Card, Dialog                | ⬜      |
| Dev panel      | `pages/DevPanel.tsx`                                      | atoms                | layout, logs                | ⬜      |
| App shell      | `App.tsx`, `TopNav.tsx`                                   | mixed                | Button, nav patterns        | ⬜      |


Legend: ⬜ not started · 🟨 in progress · ✅ complete.

## 15. Appendix: Verification commands and PR checklist

**Commands (run for UI-affecting PRs):**

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

Smoke: `npm run dev` — exercise changed routes, open dialogs, tab through focus order.

**PR checklist**

- New UI uses `src/components/ui/`* (or a documented thin wrapper), not new one-off full-screen overlay objects unless reviewed.
- No new exports in `src/components/atoms.tsx` (see `docs/shadcn-usage-guide.md`).
- Prefer `className` and semantic tokens over ad hoc hex in new code.
- No widening of trust boundaries: no new preload APIs without review; no loading arbitrary remote URLs in `BrowserWindow` for this work.
- Do not introduce patterns that render user-controlled strings as raw HTML; use normal React children or an approved sanitizer if rich text is required.
- If theme tokens change: verify focus rings and borders on dark backgrounds.

## 16. Appendix: Electron security guardrails (UI migration)


| Guardrail      | Requirement                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| IPC            | No new `contextBridge.exposeInMainWorld` surface without security review; do not pass non-serializable or executable payloads through IPC. |
| Remote content | Renderer stays on bundled Vite output; no arbitrary remote browsing inside product windows for shadcn adoption.                            |
| Native deps    | Radix stack is in policy; new native addons follow existing review path.                                                                   |
| Preload        | Keep preload minimal; renderer components must not pull Node-only modules into the renderer bundle.                                        |


Embedded webviews or remote HTML are **out of scope** for this plan and need a separate threat model.

## 17. References

- [shadcn/ui documentation](https://ui.shadcn.com/docs)
- [Theming](https://ui.shadcn.com/docs/theming)
- [Electron security tutorial](https://www.electronjs.org/docs/latest/tutorial/security)
- Repo: `docs/shadcn-usage-guide.md`, `components.json`, `tailwind.config.js`, `src/styles.css`

