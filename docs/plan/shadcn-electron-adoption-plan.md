# Exva shadcn/ui Adoption in Electron — Plan

> **Date:** 2026-05-03
> **Status:** Draft
> **Deciders:** Exva frontend owner, desktop app owner, design/theme owner

## 1. Problem Statement

Exva's renderer UI is currently built mostly with inline styles and custom atoms (`src/components/atoms.tsx`) on top of root CSS variables (`src/styles.css`), which keeps visual control but slows down feature delivery because every new screen or interaction needs custom styling and repeated component work. The app now has multiple product surfaces (Dashboard, Sessions, Strategy, Trades, Accounts), and each surface increasingly needs consistent controls (dialogs, menus, tables, inputs, badges, tabs, selectors) that are expensive to hand-roll and maintain. We need a faster UI delivery model that still preserves Exva's existing look and theme tokens rather than replacing brand identity with defaults. If we do nothing, UI development velocity stays constrained by CSS and bespoke component churn, and consistency debt will grow as more screens are added.

## 2. Goals & Non-Goals

**Goals**

| # | Goal | Success Looks Like |
|---|------|--------------------|
| G1 | Fully replace current custom renderer UI primitives with shadcn/ui-based components | Legacy custom atoms and inline-style primitives are removed from active use |
| G2 | Preserve Exva visual identity | Existing color, spacing, typography, and interaction tone remain recognizable after migration |
| G3 | Reduce custom CSS and inline-style churn | Significant share of reused controls comes from shared shadcn-based primitives |
| G4 | Keep Electron compatibility and security posture | No regression in preload/IPC boundaries or renderer hardening |

**Non-Goals**

| # | Non-Goal | Reason |
|---|----------|--------|
| NG1 | Keep a permanent hybrid of old atoms + shadcn | The project decision is full replacement, not dual-system maintenance |
| NG2 | Introduce a full visual redesign | Objective is velocity + consistency while keeping the existing theme direction |
| NG3 | Change Electron process architecture | This plan is renderer UI-layer focused, not main-process/runtime redesign |

## 3. Background & Context

Exva is an Electron Forge + Vite + React + TypeScript app (`package.json`) with renderer code under `src/`. Styling today is anchored in CSS custom properties (`--bg`, `--surface`, `--text1`, etc.) in `src/styles.css`, while many UI blocks are inline-styled in page components and atoms (for example `Card`, `Badge`, `Divider` in `src/components/atoms.tsx`). There is no existing Tailwind or shadcn setup in the repo. This means introducing shadcn requires establishing a utility/theme pipeline (Tailwind + token mapping) and a migration path from inline styles to class-based composition.

Key constraints:
- Exva's dark, high-contrast desktop look should remain stable during migration.
- The app is local-rendered in Electron; UI framework changes must not weaken existing security boundaries around IPC/preload.
- We should favor composable primitives that reduce per-page CSS decisions.

## 4. Research Summary

**shadcn/ui architecture and workflow**
- shadcn/ui is an open-code distribution model, not a sealed component package. Teams copy component source into their repo and customize it directly, which aligns well with Exva's need to preserve visual identity while accelerating delivery.
- The model emphasizes composable primitives and a shared interface, which reduces component API drift and makes future internal standardization easier.
- Key insight: this is a strong fit for "use wherever possible" because it avoids lock-in and supports local modifications when trading/desktop-specific behaviors need tweaks.
- Sources:
  - https://ui.shadcn.com/docs
  - https://github.com/shadcn-ui/ui

**shadcn theming via semantic tokens**
- shadcn recommends CSS variable-driven semantic tokens (`background`, `foreground`, `card`, `border`, `primary`, etc.) and maps them into Tailwind utilities.
- This lets a team preserve an existing theme by remapping current tokens instead of forcing default palettes.
- Key insight: Exva can keep current theme values by bridging current variables (`--bg`, `--surface*`, `--text*`, `--accent`) to shadcn semantic token names.
- Sources:
  - https://ui.shadcn.com/docs/theming
  - https://ui.shadcn.com/docs/installation

**Electron security constraints during UI modernization**
- Electron recommends strict renderer hardening (context isolation, secure content, IPC sender validation, no unsafe remote integrations).
- UI-library adoption is renderer-focused, but onboarding new dependencies and patterns still requires guardrails so no component-level pattern accidentally bypasses security assumptions.
- Key insight: migration checklist should explicitly include "no new preload surface" and "no unsafe external content patterns" to avoid accidental scope creep from UI changes.
- Sources:
  - https://www.electronjs.org/docs/latest/tutorial/security

## 5. Decided Direction (No Alternatives)

Project decision: **completely replace the current custom renderer UI layer with shadcn/ui-based components**.

Scope of replacement:
- Replace custom atoms and repeated inline-style primitives in `src/components/atoms.tsx` and page-level UI blocks.
- Standardize on `src/components/ui/*` as the component foundation.
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
- [ ] Tailwind config and CSS entry integration for `src/`
- [ ] `components.json` with CSS variables enabled
- [ ] `src/components/ui/*` baseline primitives
- [ ] UI usage guide doc in `docs/` for Exva conventions

Dependencies: none.

Risks and detection:
- Risk: build/tooling mismatch in Electron renderer.
- Detect via: `npm run typecheck`, `npm run lint`, `npm run build`, manual renderer smoke test.

Rollback plan:
- Revert only the setup commit if bootstrap fails; otherwise continue with forward-only replacement.

**Phase 1: Theme bridge and visual parity layer**

Goal: preserve Exva look while enabling shadcn semantics for complete migration coverage.

Done criteria:
- Exva current theme variables mapped to shadcn token set.
- Typography/radius/spacing defaults aligned to current UI tone.
- Visual parity checklist passes for baseline controls.

Deliverables:
- [ ] Token map in `src/styles.css` (or dedicated theme CSS)
- [ ] Mapping table doc (Exva token -> shadcn semantic token)
- [ ] Baseline snapshot comparisons for core controls

Dependencies: Phase 0.

Risks and detection:
- Risk: accidental drift in contrast/accessibility.
- Detect via: side-by-side screenshot diff + manual contrast review.

Rollback plan:
- Revert token mapping changes only if visual parity fails; continue migration after token correction.

**Phase 2: Core primitive replacement**

Goal: replace all shared primitives and remove legacy atom usage from active renderer paths.

Done criteria:
- Legacy atoms in `src/components/atoms.tsx` are either removed or reduced to temporary pass-through wrappers.
- Shared controls (buttons, cards, badges, dialogs, dropdowns, tables, form controls) are shadcn-based everywhere they appear.

Deliverables:
- [ ] `Badge`, `Card`, `Divider`, form controls migrated to shadcn-backed implementations
- [ ] Remove or deprecate legacy atom exports not needed after replacement
- [ ] Parity notes for all migrated primitive families

Dependencies: Phase 1.

Risks and detection:
- Risk: inconsistent style usage during mixed-state migration.
- Detect via: PR checklist requiring shadcn-first justification for new UI.

Rollback plan:
- Revert only failing primitive migrations; keep completed primitives in place.

**Phase 3: Page-by-page full replacement completion**

Goal: finish migration across all renderer pages and remove remaining legacy inline-style UI.

Done criteria:
- `Dashboard`, `Sessions`, `Strategy`, `Trades`, `Accounts`, and related modals/drawers use shadcn-based UI composition.
- Legacy inline-style-only layout/control patterns are removed except minimal shell layout wiring.
- PR template includes mandatory check: no new legacy UI patterns introduced.

Deliverables:
- [ ] Migration matrix tracking each page/component family until 100% completion
- [ ] PR checklist and reviewer rubric update
- [ ] Final cleanup PR removing dead legacy UI code

Dependencies: Phase 2.

Risks and detection:
- Risk: migration stalls and legacy atoms persist indefinitely.
- Detect via: monthly UI debt report (remaining non-shadcn controls).

Rollback plan:
- Revert only the last unstable page migration; continue toward full replacement after fixes.

## 8. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| R1 | Theme drift from current Exva look | Medium | High | Token bridge first, visual parity checklist before broad rollout |
| R2 | Temporary two-system inconsistency during migration | High | Medium | Aggressive page-by-page completion plan + no new legacy UI rule |
| R3 | Tailwind/shadcn setup friction in Electron toolchain | Medium | Medium | Complete Phase 0 in isolated PR with full build/test smoke |
| R4 | Accessibility regressions in custom overrides | Medium | Medium | Prefer stock shadcn patterns; test focus/contrast in migrated flows |
| R5 | Migration stalls before full replacement is complete | Medium | High | Track per-page completion to 100% and block net-new legacy UI |

## 9. Success Criteria

| Goal | Metric | Baseline | Target | How Measured |
|------|--------|----------|--------|--------------|
| G1 | Renderer pages fully migrated to shadcn-based UI | 0% | 100% by migration completion | Migration matrix + code audit |
| G2 | Core page visual parity issues after migration | Unknown | <=3 medium issues per migrated page | QA/design review log |
| G3 | Legacy inline style blocks for reusable UI controls | High (current default pattern) | >=90% reduction by migration completion | Static grep + PR stats |
| G4 | Build/type/lint pass rate during migration | Current CI pass baseline | No regression from baseline | CI history |

Leading indicators:
- First migration tranche lands with no severe regressions.
- Reviewers consistently enforce shadcn-first rule.

Lagging indicators:
- Faster delivery time for UI-heavy features.
- Lower maintenance edits per component family over time.

## 10. Open Questions

| # | Question | Owner | Needed By | Status |
|---|----------|-------|-----------|--------|
| Q1 | What is the exact page migration order for fastest end-to-end replacement? | Frontend owner | Before Phase 3 | Open |
| Q2 | Do we add visual regression snapshots in CI now or defer to manual review first? | App owner | Before Phase 3 | Open |
| Q3 | What date/milestone gates 100% replacement completion? | App owner | Before Phase 3 | Open |

## 11. Alternatives Rejected

Alternatives are intentionally not carried forward. Team decision is full replacement of the current custom UI layer with shadcn-based components.
