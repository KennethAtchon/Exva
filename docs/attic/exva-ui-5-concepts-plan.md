# Exva UI — Modern Productivity Direction: Four Variants

> **Date:** 2026-07-14  
> **Status:** M0 mockups complete — awaiting sign-off  
> **Owner:** Ken  
> **Milestone:** M0 (static HTML gallery)  
> **Gallery:** [`mockups/`](./mockups/) — `python3 -m http.server 8767`

## Executive Summary

Exva's renderer gets a single aesthetic direction — **Linear/Raycast productivity** — with four layout variants that differ only in **bones** (spatial structure), not skin. The old five-theme exploration (Glass Cockpit, Split Flap, Green Ledger, Swiss Fund, Heat Console) is **rejected**: themes are not tools; one coherent system beats five decorative skins.

**Recommendation:** **Ops Console** (P3) as primary direction. **Linear Core** (P1) as runner-up for teams that prefer page-push detail over persistent inspector.

---

## §1 — Invariants (all variants)

These rules apply to every mockup and the eventual renderer implementation.

| Invariant | Rule |
|-----------|------|
| P&amp;L display | Always signed (`+1,842.17` / `−387.00`), never bare positive |
| Direction glyph | `▲` up / `▼` down adjacent to percentage change |
| Numerals | `font-variant-numeric: tabular-nums` on all financial figures |
| Tick flash | Row background pulse on price update (green up / red down, 150ms) |
| Hub shortcuts | `⌘1`–`⌘6` for primary navigation targets |
| Row density | Table rows ≤ **32px** height |
| Command palette | `⌘K` is primary navigation affordance on every screen |
| Accent usage | `#5E6AD2` for **selection only** — active nav, selected row, primary CTA, active tab underline. Never body text. |

---

## §2 — Palette & Typography (LOCKED)

### Aesthetic

- **Reference:** Linear, Raycast — dark graphite productivity
- **Structure:** Hairline borders (`1px solid`), flat surfaces
- **Banned:** Shadows, gradients, glow, glass blur, decorative textures
- **Type:** Inter (UI) + IBM Plex Mono (figures, timestamps, kbd hints)
- **Density:** Compact lists, information-forward tables

### Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--bg` | `#08090A` | App background |
| `--surface` | `#0F1011` | Panels, sidebars, cards |
| `--surface-hover` | `#16171A` | Row hover, button hover |
| `--border` | `#23252A` | All dividers and outlines |
| `--text` | `#F7F8F8` | Primary text |
| `--text-dim` | `#8A8F98` | Secondary labels |
| `--text-faint` | `#62666D` | Tertiary / column headers |
| `--accent` | `#5E6AD2` | Selection, active states, primary buttons |
| `--accent-soft` | `rgba(94,106,210,0.12)` | Selected row / nav background |
| `--up` | `#4CC38A` | Positive P&amp;L, bullish tick |
| `--down` | `#E5484D` | Negative P&amp;L, bearish tick |
| `--caution` | `#F5B841` | Warnings, attention items |

Implemented in [`mockups/skin.css`](./mockups/skin.css). WCAG body-text pairs validated in [`mockups/contrast-check.html`](./mockups/contrast-check.html).

---

## §3 — Rejected: Five Theme Exploration

The prior M0 cycle produced five decorative themes. All rejected for the same reason:

| Old theme | Why rejected |
|-----------|--------------|
| Glass Cockpit | Glass blur and glow violate hairline-flat rule |
| Split Flap | Retro metaphor adds noise without improving scan speed |
| Green Ledger | Terminal-green skin is a theme swap, not a layout decision |
| Swiss Fund | Typography-led branding ≠ productivity tooling |
| Heat Console | Heat-map color system conflicts with signed P&amp;L invariants |

**Decision:** One skin. Four bones. No theme picker in M1+.

---

## §4 — Four Layout Variants

Variants differ **only** in spatial structure. Shared: §1 invariants, §2 palette, `skin.css`, `data.js`, `EXVA_MOCK` fixture.

### P1 — Linear Core

| Property | Value |
|----------|-------|
| Sidebar | 220px persistent |
| Detail pattern | Page-push panel (400px, content reflows) |
| Best for | Users who want full-width lists until they drill in |
| Mockups | `p1-linear-core/dashboard.html`, `sessions.html` |

### P2 — Command Surface

| Property | Value |
|----------|-------|
| Sidebar | None |
| Navigation | `⌘K` command palette is primary nav |
| Detail pattern | Inline expand below selected row |
| Default state | Dashboard opens with palette pre-filled (`nvda`) |
| Best for | Power users, minimal chrome, keyboard-first |
| Mockups | `p2-command-surface/dashboard.html`, `sessions.html` |

### P3 — Ops Console ★ RECOMMENDED

| Property | Value |
|----------|-------|
| Sidebar | 220px persistent |
| View tabs | Secondary filter within hub (Positions / Attention / Agent log) |
| Detail pattern | Persistent 380px inspector, list+inspector split |
| Best for | Day-to-day operations — scan list, inspect without losing context |
| Mockups | `p3-ops-console/dashboard.html`, `sessions.html` |

**Why recommended:** Trading ops requires simultaneous list scan and detail inspection. The split layout keeps NVDA (or any selected row) visible while scrolling the book. View tabs add hub-level filtering without route changes. Matches how operators actually work.

### P4 — Board Workspace

| Property | Value |
|----------|-------|
| Nav | 56px icon rail |
| Content | Grouped sections (Winners / Losers / Attention) |
| Detail pattern | Slide-over sheet (420px), visible by default in mockups |
| Best for | Portfolio-level grouping, visual segmentation |
| Mockups | `p4-board-workspace/dashboard.html`, `sessions.html` |

---

## §5 — M0 Deliverables

| Artifact | Path | Status |
|----------|------|--------|
| Shared CSS | `mockups/skin.css` | ✅ |
| Shared data | `mockups/data.js` | ✅ |
| P1 pages | `mockups/p1-linear-core/*.html` | ✅ |
| P2 pages | `mockups/p2-command-surface/*.html` | ✅ |
| P3 pages | `mockups/p3-ops-console/*.html` | ✅ |
| P4 pages | `mockups/p4-board-workspace/*.html` | ✅ |
| Gallery | `mockups/index.html` | ✅ |
| Contrast check | `mockups/contrast-check.html` | ✅ |
| README | `mockups/README.md` | ✅ |

### Gallery controls

- Click variant pills or press `1`–`4`
- `D` / `S` toggles dashboard vs sessions
- `←` / `→` cycles variants
- Ops Console marked ★ in gallery

---

## §6 — Recommendation & Next Steps

### Primary: Ops Console (P3)

- Persistent inspector matches operator workflow
- View tabs scale to additional hub filters without new routes
- Sidebar retains hub wayfinding for `⌘1`–`⌘6` targets

### Runner-up: Linear Core (P1)

- Simpler implementation (push panel vs split resize)
- Better when detail is occasional, not constant

### Deferred

- **Command Surface (P2):** Viable for a "focus mode" toggle, not default — loses hub discoverability
- **Board Workspace (P4):** Useful for portfolio hub; less suited to dense position tables

### M1 (post sign-off)

1. Port `skin.css` tokens into renderer CSS variables / Tailwind config
2. Implement chosen layout (P3) in `src/` shell component
3. Wire `⌘K` palette to existing IPC routes
4. Add Vitest snapshot or Playwright screenshot tests against mockup baselines
5. Delete old five-theme mockup directories if any remain

---

## §7 — Sign-off Checklist

- [ ] Palette tokens approved (§2)
- [ ] Invariants approved (§1)
- [ ] Primary variant selected (P3 recommended)
- [ ] Runner-up noted for fallback (P1)
- [ ] Old five themes confirmed rejected
- [ ] M1 implementation owner assigned
