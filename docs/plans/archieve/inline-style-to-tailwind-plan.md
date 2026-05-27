# Inline Style to Tailwind Migration — Plan

> **Date:** 2026-05-27
> **Status:** Implemented (2026-05-26)
> **Deciders:** Kenneth

---

## 1. Problem Statement

Exva still carries a large amount of static renderer styling in JavaScript objects and inline `style={{}}` blocks even after the semantic color-token cleanup. The specific pain point is not dynamic styles like `width: `${pct}%``or`transform: scaleX(...)`; it is static presentational CSS living in TypeScript, for example `const lessonChipStyle = { padding: "2px 7px", borderRadius: 4, background: "var(--surface3)", fontSize: 12, fontFamily: "var(--font-mono)" } as const`. Those objects are effectively hand-written utility bundles, but they bypass Tailwind's source of truth, make UI structure harder to scan, and force style decisions to be spread across markup and nearby constants. The current lint rule now exposes this clearly: the repo has no remaining raw hex literals in `src/`, but it still produces hundreds of static-inline-style warnings. If nothing is done, Exva will remain half-migrated: color theming will be centralized, but day-to-day component layout and typography work will still drift toward inline CSS instead of converging on Tailwind-first renderer conventions.

---

## 2. Goals & Non-Goals

**Goals**

| #   | Goal                                     | Success Looks Like                                                                                                         |
| --- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | Convert static style objects to Tailwind | Style constants like `lessonChipStyle` become class strings or inline `className` values                                   |
| 2   | Keep dynamic styles explicit             | Only truly computed values remain in `style={{}}`                                                                          |
| 3   | Define a repeatable migration method     | Engineers can look at any style object and classify it the same way                                                        |
| 4   | Minimize Tailwind sprawl                 | Repeated class bundles become local class constants or `cn(...)` calls instead of duplicated unreadable strings everywhere |
| 5   | Let lint become enforcement, not noise   | Static-inline-style warnings trend to zero and can later be upgraded to errors                                             |

**Non-Goals**

| #   | Non-Goal                                                | Reason                                                                          |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1   | Rewriting dynamic layout logic                          | Runtime-computed values still belong in `style`                                 |
| 2   | Replacing every object constant with custom CSS classes | The target is Tailwind utilities, not new CSS abstraction                       |
| 3   | Global design-system redesign                           | This plan is about representation, not changing the visual language             |
| 4   | Codemodding the entire renderer blindly                 | Mapping decisions require judgment, especially for mixed static/dynamic objects |

---

## 3. Background & Context

The current renderer uses three static-style patterns:

1. Top-level style object constants, for example in `src/components/autopsy/LessonsPanel.tsx`:

```tsx
const lessonChipStyle = {
  padding: "2px 7px",
  borderRadius: 4,
  background: "var(--surface3)",
  fontSize: 12,
  fontFamily: "var(--font-mono)",
} as const;
```

2. Top-level grouped style registries like `const S = { ... }` in `src/pages/DevPanel.tsx`, where some entries are fully static, some are mixed, and some are genuinely dynamic.

3. One-off inline `style={{}}` objects directly in JSX, often used for simple layout wrappers like `display: "flex"`, `gap: 8`, `marginTop: 4`, or `width: "100%"`.

Important constraints from the current codebase:

- Tailwind is already installed and active in the renderer.
- Semantic color tokens are now available in `src/styles.css` and mapped in `tailwind.config.js`.
- The renderer already uses arbitrary-value utilities like `rounded-[14px]`, `text-[12px]`, and `bg-[var(--surface2)]`, so the project accepts Tailwind bracket syntax where the default scale does not match existing values.
- Some renderer helpers already compose classes using `cn(...)` from `src/lib/utils.ts`.
- The inline-style lint rule is present in `eslint.config.js`, but currently set to warn because static inline styles are still widespread.

The migration therefore does not need new libraries, a new design system, or CSS Modules. It needs a disciplined conversion strategy.

---

## 4. Research Summary

**Tailwind utility-first over inline styles**

- Tailwind's core guidance is that utility classes are preferable to inline styles for static presentation because they preserve design constraints, support responsive/state variants, and keep styling decisions in the markup rather than hidden in parallel objects. The key point for Exva is that static object literals like `lessonChipStyle` are functionally a custom utility layer with weaker tooling and worse discoverability.
- The practical implication is that any static value that can be represented by a utility should move to `className`, even if that utility uses arbitrary values.
- Sources:
  - https://tailwindcss.com/docs/styling-with-utility-classes

**Arbitrary values are the correct bridge for exact existing values**

- Tailwind explicitly supports arbitrary values for one-off cases like `px-[7px]`, `rounded-[4px]`, `text-[12px]`, `bg-[var(--surface3)]`, and `tracking-[0.04em]`. This matters because many Exva style objects use values that do not line up perfectly with Tailwind's default spacing or radius scale.
- The right migration behavior is not “approximate to nearest stock utility unless it is close enough”; it is “preserve the exact value with bracket syntax when needed, and only normalize to stock utilities when the value already matches a standard utility cleanly.”
- Sources:
  - https://tailwindcss.com/docs/adding-custom-styles

**Reuse strategy: class composition beats new CSS classes for local patterns**

- Tailwind's guidance for repeated styling is to prefer component reuse, loops, class composition, and localized abstractions before introducing custom CSS classes. For Exva, that means a repeated static object should usually become either a shared class string constant, a `cn(...)` composition, or a small component boundary, not a new `.lesson-chip` CSS selector in `styles.css`.
- This keeps the migration aligned with the renderer's existing React component model and avoids recreating a second styling system after removing inline styles.
- Sources:
  - https://tailwindcss.com/docs/styling-with-utility-classes
  - https://tailwindcss.com/docs/adding-custom-styles

---

## 5. Options Considered

**Option A: Leave style objects in place and only keep warning-level lint**

This keeps the repo working and relies on gradual manual cleanup whenever a file is touched.

| Dimension      | Assessment                                                    |
| -------------- | ------------------------------------------------------------- |
| Complexity     | Low                                                           |
| Performance    | Neutral                                                       |
| Reliability    | Low implementation risk, high long-term inconsistency risk    |
| Cost           | Cheap now, expensive over time                                |
| Reversibility  | N/A                                                           |
| Stack fit      | Poor — renderer remains split between Tailwind and object CSS |
| Team readiness | Easy to do, but does not create convergence                   |

Risks:

- Warnings become background noise and stop driving behavior.
- Engineers keep adding new object constants because the existing pattern still dominates.

Open questions:

- None. This is the status quo.

**Option B: Pure codemod approach**

Write or use a codemod to convert object properties like `padding`, `marginTop`, `fontSize`, and `borderRadius` to utility classes mechanically.

| Dimension      | Assessment                                                                     |
| -------------- | ------------------------------------------------------------------------------ |
| Complexity     | Medium                                                                         |
| Performance    | Neutral                                                                        |
| Reliability    | Medium-low — mixed objects and semantic judgment make false conversions likely |
| Cost           | Moderate upfront tooling effort                                                |
| Reversibility  | Moderate                                                                       |
| Stack fit      | Partial                                                                        |
| Team readiness | Requires careful tooling work and review discipline                            |

Risks:

- A codemod cannot reliably decide whether `rounded-[4px]` should remain exact or normalize to `rounded`.
- It cannot easily separate reusable class bundles from one-off inline conversions.
- Mixed static/dynamic objects like many in `DevPanel.tsx` are poor codemod targets.

Open questions:

- Is the codemod effort justified if manual classification is still needed afterward?

**Option C: File-by-file manual classification with explicit conversion rules (Recommended)**

Convert static style objects and static JSX inline styles file by file using a strict classification rubric:

1. Fully static object -> replace with `className` or a class string constant.
2. Mixed static/dynamic object -> extract static properties into `className`, leave computed properties inline.
3. Fully dynamic object -> keep inline.

| Dimension      | Assessment                                      |
| -------------- | ----------------------------------------------- |
| Complexity     | Medium                                          |
| Performance    | Neutral                                         |
| Reliability    | High — decisions stay reviewable and local      |
| Cost           | Moderate engineering time                       |
| Reversibility  | High                                            |
| Stack fit      | Excellent                                       |
| Team readiness | High — follows existing React/Tailwind patterns |

Risks:

- Large files like `DevPanel.tsx` will still take time.
- Arbitrary-value class strings can become noisy if not grouped cleanly.

Open questions:

- Where should repeated class bundles live: local `const fooClass = "..."` strings, or inlined `className` strings directly?
- When should a repeated pattern become a component instead of a shared class string?

---

## 6. Recommendation

**We recommend Option C: file-by-file manual classification with explicit conversion rules.**

This is the best fit for Exva because the problem is not just syntax replacement; it is ownership clarity. The repo already has mixed static/dynamic style usage, arbitrary values, semantic token colors, and large object registries in places like `DevPanel.tsx`. A codemod would still leave a large manual review burden, while the status quo leaves the renderer permanently split between Tailwind and object CSS. Manual classification gives the team a stable method that can be applied incrementally without guessing.

We do not recommend custom CSS classes as the default destination because that would simply move static styling out of object literals and into a second abstraction layer, which undermines the goal of making the renderer Tailwind-first. We also do not recommend trying to eliminate every inline style globally in one shot; dynamic values must remain inline, and the migration is safest when done in shippable slices.

This recommendation depends on two assumptions:

1. The team accepts arbitrary-value Tailwind classes where exact preservation is needed.
2. The team is willing to tolerate a warning-only lint phase until the remaining static inline styles are burned down.

If those assumptions change, the recommendation would need to shift toward either a coarser approximation strategy or a custom CSS utility layer, both of which are weaker fits.

---

## 7. Implementation Plan

### Phase 1: Define the conversion rubric

Goal: make every migration decision mechanical and reviewable.

Done criteria:

- [x] Document the object-classification rules in `THEMING.md` or a companion renderer-style doc.
- [x] Define exact mapping rules for common properties.
- [x] Define when to use stock utilities vs arbitrary values.
- [x] Define when repeated class bundles should become local constants.

Core rules:

| Pattern                                  | Action                                                |
| ---------------------------------------- | ----------------------------------------------------- |
| Fully static object constant             | Replace with `className` or `const someClass = "..."` |
| Static JSX inline wrapper                | Replace with direct `className`                       |
| Mixed object with 1-3 dynamic properties | Keep `style`, extract static props to `className`     |
| Fully dynamic object                     | Leave inline                                          |
| Exact value exists in Tailwind scale     | Use stock utility                                     |
| Exact value does not exist in scale      | Use arbitrary value utility                           |

Example mapping for the motivating case:

```tsx
// BEFORE
const lessonChipStyle = {
  padding: "2px 7px",
  borderRadius: 4,
  background: "var(--surface3)",
  fontSize: 12,
  fontFamily: "var(--font-mono)",
} as const;

// AFTER
const lessonChipClass =
  "rounded-[4px] bg-[var(--surface3)] px-[7px] py-[2px] font-mono text-[12px]";
```

Dependencies: none.
Rollback: none needed; documentation-only phase.

### Phase 2: Convert small reusable style constants first

Goal: remove the easiest high-reuse style objects and establish the pattern.

Done criteria:

- [x] Convert small top-level static constants in compact components.
- [x] Prefer local class string constants over creating custom CSS selectors.
- [x] Keep diffs scoped to one component at a time.

Priority file types:

- `src/components/autopsy/*`
- `src/components/accounts/*`
- `src/components/sessions/*` small support components
- `src/components/strategy/*` small cards/rows

Preferred output forms:

1. Single-use wrapper -> inline `className`
2. Reused local bundle -> `const fooClass = "..."`
3. Variant bundle -> `cn(baseClass, active && activeClass)`

Dependencies: Phase 1 rules written down.
Rollback: revert individual files.

### Phase 3: Convert medium pages and mixed object patterns

Goal: reduce warning count significantly in page-level renderer files.

Done criteria:

- [x] Convert static wrapper styles in `Dashboard`, `TradesPage`, `TradeDetail`, `SessionsPage`, and `StrategyConfig`.
- [x] For mixed objects, leave dynamic properties in `style` and move only static ones to classes.
- [x] Replace repeated style registries with local class constants where the values are fully static.

Decision rule for mixed cases:

```tsx
// BEFORE
<div style={{
  display: "flex",
  gap: 8,
  color: stateColor,
  width: `${pct}%`,
}} />

// AFTER
<div
  className="flex gap-2"
  style={{
    color: stateColor,
    width: `${pct}%`,
  }}
 />
```

Dependencies: Phase 2 patterns validated.
Rollback: revert per file.

### Phase 4: DevPanel structural cleanup

Goal: reduce the warning concentration in `src/pages/DevPanel.tsx`.

Done criteria:

- [x] Convert fully static `S.*` entries into class strings.
- [x] Split mixed entries into `className` + dynamic `style` pairs.
- [x] Keep dynamic color/runtime values inline where needed.
- [x] Reduce `DevPanel.tsx` warning count by at least 60% before attempting warning-to-error escalation (219 → 0).

Special rules:

- Do not expand one `style` object into unreadable 30-token inline classes if the style bundle is reused repeatedly; prefer `const panelRowClass = "..."` near the component.
- Avoid introducing custom CSS selectors unless Tailwind cannot express the property cleanly and the pattern is repeated enough to justify a utility class.

Dependencies: Phase 3 complete.
Rollback: split into multiple commits or revert file sections incrementally.

### Phase 5: Tighten lint enforcement

Goal: make static inline styles a real regression blocker.

Done criteria:

- [x] Static-inline-style warnings drop to an agreed threshold (947 → 0).
- [x] Escalate `theming/no-static-inline-styles` from `warn` to `error`.
- [x] Restrict allowed inline styles to dynamic properties only.

Recommended threshold before escalation:

- Global renderer warning count under 50, with no concentration spikes in any single core page.

Dependencies: Phases 2-4 complete enough that lint is actionable.
Rollback: revert rule severity from `error` back to `warn`.

---

## 8. Risk Register

| #   | Risk                                                      | Likelihood | Impact | Mitigation                                                      |
| --- | --------------------------------------------------------- | ---------- | ------ | --------------------------------------------------------------- |
| 1   | Arbitrary-value classes become unreadable                 | Medium     | Medium | Use local class string constants for reused bundles             |
| 2   | Mixed objects are partially migrated incorrectly          | Medium     | Medium | Only extract clearly static props; leave computed props inline  |
| 3   | Engineers recreate CSS object constants as class objects  | Medium     | Low    | Document preferred output forms and review against them         |
| 4   | DevPanel remains a warning hotspot for too long           | High       | Medium | Treat it as its own phase with measurable reduction targets     |
| 5   | Stock utility approximations subtly change spacing/radius | Medium     | Low    | Prefer exact arbitrary values unless the stock mapping is exact |

---

## 9. Success Criteria

| Goal                            | Metric                                                    | Baseline             | Target                         | How Measured                       |
| ------------------------------- | --------------------------------------------------------- | -------------------- | ------------------------------ | ---------------------------------- |
| Static object conversion        | Static style constants still present in renderer          | High                 | Near-zero except dynamic cases | grep/read review in `src/`         |
| Tailwind-first renderer         | `theming/no-static-inline-styles` warnings                | 900+ range currently | <50 before error escalation    | `bun run lint`                     |
| Dynamic-inline boundary clarity | Inline styles containing only computed values             | Mixed                | Dominant pattern               | Code review + lint output sampling |
| Reuse quality                   | Repeated local style bundles expressed as class constants | Inconsistent         | Standardized in migrated files | File review                        |

---

## 10. Open Questions

| #   | Question                                                                                                  | Owner   | Needed By                   | Status                                                              |
| --- | --------------------------------------------------------------------------------------------------------- | ------- | --------------------------- | ------------------------------------------------------------------- |
| 1   | Should repeated class bundles default to `const fooClass` strings or `cn(...)` composition helpers?       | Kenneth | Before broad page migration | Resolved — `const fooClass` for static bundles; `cn()` for variants |
| 2   | What warning threshold is low enough before promoting static-inline lint to error?                        | Kenneth | Before enforcement phase    | Resolved — 0 static-inline warnings; rule escalated to `error`      |
| 3   | Are there any property families we want to permanently exempt from the rule besides truly dynamic values? | Kenneth | Before enforcement phase    | Resolved — none; dynamic colors/widths/transforms remain in `style` |

---

## 11. Alternatives Rejected

| Option                                                     | Why Rejected                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Leave warnings indefinitely                                | Preserves the exact inconsistency this cleanup is meant to remove               |
| Pure codemod                                               | Too much judgment required for mixed objects and reuse decisions                |
| Replace object constants with custom CSS component classes | Recreates a second styling system instead of making the renderer Tailwind-first |
