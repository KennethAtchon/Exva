# Prompt: Redesign the Entire Exva Documentation Page

## Role

You are a senior frontend engineer + product designer working inside an existing Electron + React + TypeScript + Tailwind app (Exva, a signal-driven trading tool). Your job is to elevate the **entire in-app documentation experience** — sidebar, content area, on-this-page TOC, page header, pager, and related-pages — into a polished, modern, "real documentation site" feel (think Stripe / Mintlify / Linear docs), while preserving the existing registry-driven architecture, hash routing, and design tokens.

This is **not** just the sidebar. Treat the docs route as one cohesive product surface and improve all of it.Use your frontend design skill.

## Goal — what "better and more proper" means

The docs already work but feel flat and basic. Make them feel intentional and premium:

1. **Sidebar → real nav tree:** collapsible/expandable folders with chevrons, nested active-page → heading drill-down, persistent expand state, auto-expand the active group, clean active/hover/focus states.
2. **Content area → proper reading experience:** better typographic rhythm, comfortable measure, anchored headings with hover-reveal "#" links, code blocks with optional copy button, refined callouts/tables/cards.
3. **On-this-page TOC:** keep the scroll-spy, but make the active marker and indentation crisper; add a subtle active rail/indicator.
4. **Page header + breadcrumbs:** show a breadcrumb (Group › Page), keep title/description, optionally add prev/next context.
5. **Pager + related pages:** keep but visually tighten so they feel part of one system.
6. **Cohesion + polish:** consistent spacing scale, dividers, density, empty/loading/error states, responsive behavior, and accessibility throughout.

The bar: a developer opening this route should think "this is a real docs site," not "this is a settings panel with a list."

## Hard constraints — read before writing code

- **Registry is the single source of truth.** Nav structure and page metadata come from `src/components/docs/registry.ts` (`DOC_NAV_GROUPS`, `DOC_PAGES`) and `src/components/docs/types.ts`. Do **not** hardcode page/group lists in components. If the model needs to change to support nesting, breadcrumbs, or icons, extend the **types + registry** minimally and typed — never magic strings in JSX.
- **Do not break routing.** Routing is hash-based via `DocsNavigationProvider` in `src/components/docs/context.tsx`: `navigate(slug, headingId?)`, hashes `#doc-<slug>` and `#doc-<slug>/<headingId>`, `useDocsNavigation()` → `{ slug, page, navigate, pager, allPages }`, `useDocHeadings()`. Every link/anchor must route through `navigate(...)`. Do not introduce a second router or `react-router`.
- **Use the existing design tokens — never raw colors.** Tokens in use: `var(--bg)`, `var(--surface)`, `var(--surface2)`, `var(--surface3)`, `var(--border)`, `var(--text1)`, `var(--text2)`, `var(--text3)`, `var(--accent)`. Status tokens exist too: `info-border`/`info-dim`, `warning-border`/`warning-dim`, `success-border`/`success-dim`, `error-border`/`error-dim`, and `hsl(var(--primary-foreground))`. Font sizing is explicit bracket syntax (`text-[13px]`, `tracking-[0.12em]`). Use `cn()` from `@/lib/utils` for conditional classes. Match existing rounding (`rounded-md`/`rounded-lg`) and uppercase-label treatment.
- **Surgical scope.** Stay inside `src/components/docs/` and `src/pages/DocsPage.tsx`. Do **not** touch the top nav (`src/components/TopNav.tsx` / `NavShell`), the app sidebar, or unrelated app pages. Do not restyle global theme tokens.
- **Don't rewrite content pages by hand.** There are ~17 content pages under `src/components/docs/pages/` that compose shared primitives. Improve them **only** by improving the shared primitives in `primitives.tsx` (and `DocMermaid.tsx`) so every page benefits. Do not edit each page individually unless a change is purely mechanical and safe.
- **No new dependencies.** `lucide-react` is already available (`ChevronDown`, `ChevronRight`, `ChevronLeft`, `Search`, `Copy`, `Check`, `Link` icons are fair game). Mermaid is already wired via `DocMermaid.tsx`.
- **TypeScript strict.** No `any`. Reuse `DocSlug`, `DocNavGroup`, `DocPageDefinition`, `DocHeadingAnchor`. Output must pass the project's lint + typecheck.

## Current architecture (accurate, as of this codebase)

**Route entry:** `src/pages/DocsPage.tsx`

- Wraps everything in `DocsNavigationProvider`.
- Three-column flex layout: `<DocsSidebar />` | `<main data-doc-content>` (scrollable, `max-w-3xl` centered content with `DocPageHeader`, the active `<Page />` inside a `DocsContentErrorBoundary`, then `<RelatedPages />`, `<DocPager />`, footer) | `<DocsToc />`.
- `DocsContentErrorBoundary` already renders a fallback if a page throws — keep this pattern.

**Layout + header:** `src/components/docs/DocsLayout.tsx`

- `DocsLayout` = simple flex shell. `DocPageHeader` = category eyebrow + `h1` title + description paragraph.

**Sidebar:** `src/components/docs/DocsSidebar.tsx` (~104 lines)

- `w-[240px]` aside, "Documentation" header + search input.
- While searching: flat `searchDocPages(query)` results.
- Otherwise: maps `DOC_NAV_GROUPS`, renders each `label` as a static uppercase heading, then flat `<button>`s per `group.slugs` calling `navigate(pageSlug)`. **No collapse, no chevrons, no heading sub-nav, no persistence.**

**On-this-page TOC:** `src/components/docs/DocsToc.tsx`

- `w-[200px]` right aside, `xl:flex` only. Uses `IntersectionObserver` scroll-spy (`rootMargin: "-15% 0px -70% 0px"`) to set active heading. Renders `useDocHeadings()` (the active page's registry `headings`). Indents `level === 3`. Active = `text-[var(--accent)]`.

**Pager + related:** `src/components/docs/DocPager.tsx`

- `DocPager` = prev/next cards from `getDocPager(slug)`. `RelatedPages` = chips from `page.related`.

**Content primitives:** `src/components/docs/primitives.tsx`

- Shared building blocks every page uses: `DocHeading` (h2/h3 with `id` + `scroll-mt-6`), `DocParagraph`, `DocInlineCode`, `DocStrong`, `DocLink` (routes via `navigate`), `DocList`, `DocCallout` (info/warning/tip), `DocCode` (pre block), `DocTable`, `FlowStep`, `GlossaryTerm`, `DocCardGrid` + `DocCard`. Re-exports `DocMermaid`.

**Mermaid:** `src/components/docs/DocMermaid.tsx` renders diagrams; diagram strings live in `src/components/docs/diagrams.ts`.

**Registry:** `src/components/docs/registry.ts`

- Exports `DOC_NAV_GROUPS` (`{ id, label, slugs }[]`), `DOC_PAGES`, `listDocPages()`, `searchDocPages()`, `getDocPage()`, `getDocPager()`, `DEFAULT_DOC_SLUG`.
- 6 groups: **Getting started, Concepts, Architecture, Signals (6 pages), Operations (4 pages), Reference.** ~17 pages total. Many pages declare `headings` (H2/H3 anchors) used by both the TOC and (newly) the sidebar drill-down.

**Types:** `src/components/docs/types.ts`

- `DocSlug` (union), `DocNavGroup = { id; label; slugs: DocSlug[] }`, `DocPageDefinition = { slug; title; description; category; order; related?; headings: DocHeadingAnchor[]; component }`, `DocHeadingAnchor = { id; title; level: 2|3 }`.

**Page content example:** `src/components/docs/pages/SessionsDocPage.tsx`

- Pure composition of primitives: `DocHeading` + `DocParagraph` + `DocMermaid` + `DocTable` + `DocList` + `DocLink`. Headings' `id`s match the registry `headings` entries (e.g. `session-lifecycle`, `session-statuses`). This is the pattern — improve primitives, not each page.

## Deliverables (per surface)

### 1. Sidebar — `DocsSidebar.tsx`

- Group rows become collapsible folder toggles with a rotating/swapping chevron and `aria-expanded`.
- Persist open/closed state per group in `localStorage`; the group containing the active page is always expanded on load regardless of saved state.
- When a page is active and has `headings`, render them indented beneath it as sub-links that call `navigate(slug, heading.id)`; highlight the active heading (sync with the URL hash heading / scroll-spy if feasible).
- Distinct active page, active group, hover, and focus-visible states using existing tokens.
- Keep search: flat filtered results, clicking navigates and clears the query.

### 2. Content area + header — `DocsPage.tsx` + `DocsLayout.tsx`

- Add a **breadcrumb** (Group › Page) above the title, derived from the registry (find which `DOC_NAV_GROUPS` entry contains the slug). Add a typed helper in `registry.ts` like `getDocGroupForSlug(slug)` rather than computing in JSX.
- Tighten the header: eyebrow/breadcrumb, `h1`, description, optional thin divider. Keep the existing error boundary and footer.
- Verify the reading column measure (`max-w-3xl`) and vertical rhythm feel right; adjust spacing tokens only within the docs content.

### 3. Primitives — `primitives.tsx` (+ `DocMermaid.tsx` if needed)

- `DocHeading`: add a hover-revealed anchor affordance (a `#`/link icon) that copies/links to `#doc-<slug>/<id>` via `navigate`. Keep `id` + `scroll-mt`.
- `DocCode`: add an optional copy-to-clipboard button (top-right, hover-reveal) with a `Copy → Check` swap. Keep monospace styling and token colors.
- Refine `DocCallout`, `DocTable`, `FlowStep`, `DocCard` spacing/borders for consistency — do not change their public props/signatures (pages depend on them).

### 4. TOC — `DocsToc.tsx`

- Keep `IntersectionObserver` scroll-spy. Add a subtle active rail/indicator (e.g. a left accent bar on the active item) and crisper indentation. Keep `xl:flex`-only visibility.

### 5. Pager + related — `DocPager.tsx`

- Visually align with the rest (consistent card radius, borders, hover). No behavior change required.

## Behavior spec (acceptance criteria)

- [ ] Sidebar groups expand/collapse with chevrons; state persists across reloads; active group auto-expands.
- [ ] Active page shows its headings nested in the sidebar; clicking a heading scrolls to it and updates the hash.
- [ ] Breadcrumb (Group › Page) renders above every page title, derived from the registry via a typed helper.
- [ ] Headings show a hover anchor that links to the section; code blocks have a working copy button with `Copy → Check` feedback.
- [ ] TOC scroll-spy still tracks the visible section and shows a clear active indicator.
- [ ] Search still filters to flat results; clicking navigates and clears the query.
- [ ] Full keyboard operability (Tab + Enter/Space) and visible focus states on all interactive elements; `aria-expanded` on folder toggles; existing `aria-label`s preserved.
- [ ] Responsive: TOC hides below `xl` (as today); sidebar + content remain usable; nothing overflows horizontally.
- [ ] No TypeScript errors, no `any`, tokens only. Passes lint + typecheck. Content pages render unchanged in meaning (only styling improved via primitives).

## Style references (copy these patterns exactly)

```tsx
// aside shell — keep width + borders
"flex w-[240px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)]"

// active vs inactive nav row (existing)
className={cn(
  "block w-full rounded-md px-3 py-2 text-left text-[13px] transition-colors",
  active
    ? "bg-[var(--surface2)] font-medium text-[var(--text1)]"
    : "text-[var(--text2)] hover:bg-[var(--surface2)] hover:text-[var(--text1)]",
)}

// uppercase group/eyebrow label (existing)
"text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text3)]"

// scrollable content main (existing)
"flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-[var(--surface)]"
"mx-auto w-full max-w-3xl flex-1 px-7 py-8 lg:px-9"

// TOC active heading (existing)
activeId === heading.id ? "font-medium text-[var(--accent)]" : "text-[var(--text3)] hover:text-[var(--text2)]"
```

## Output format

For each file you create or modify, return its full contents in a code block headed by its path. Before the code, give a short (3–6 sentence) summary of: the registry/type additions (e.g. `getDocGroupForSlug`, any `DocNavGroup` field), the persistence approach, and which primitives changed. Do not include unrelated edits, dependency changes, or boilerplate. Confirm at the end that lint + typecheck pass (or list exactly what to run).

```

```
