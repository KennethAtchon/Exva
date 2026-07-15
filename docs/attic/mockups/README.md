# Exva M0 Mockup Gallery

Static HTML mockups for the four UI layout variants (M0 milestone).

## Quick start

From this directory:

```bash
python3 -m http.server 8767
```

Open [http://localhost:8767](http://localhost:8767) for the gallery.

Use port **8767** deliberately — other ports may be stale from prior sessions.

## Structure

| Path | Description |
|------|-------------|
| `index.html` | Gallery shell — variant picker, D/S screens, keyboard nav |
| `contrast-check.html` | WCAG contrast validation for §2 palette |
| `skin.css` | Shared design system (tokens, tables, cmd menu, etc.) |
| `data.js` | `EXVA_MOCK` fixture data and render helpers |
| `p1-linear-core/` | 220px sidebar + page-push detail |
| `p2-command-surface/` | No sidebar, ⌘K navigation, inline expand |
| `p3-ops-console/` | Sidebar + view tabs + 380px inspector **(recommended)** |
| `p4-board-workspace/` | 56px icon rail + grouped sections + slide-over |

## Keyboard shortcuts (gallery)

- `1`–`4` — switch variant
- `D` / `S` — dashboard / sessions screen
- `←` / `→` — prev / next variant

## Plan document

See [`../exva-ui-5-concepts-plan.md`](../exva-ui-5-concepts-plan.md) for full rationale, invariants, and recommendation.
