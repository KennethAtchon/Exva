# Exva Full System Audit — 2026-07-17

Purpose: a complete, execution-ready audit of Exva for a fixer AI. Each doc is standalone: it explains the relevant part of the system, what is wrong (with file:line evidence), and exactly how to fix it. Work through the docs in order; within each doc, follow its own execution order.

| #   | Doc                                                  | Scope                                                                                                                      | Status                               |
| --- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 01  | [System overview](01-system-overview.md)             | What Exva is and how the pieces connect — read first                                                                       | ready                                |
| 02  | [Backend flaws](02-backend-flaws.md)                 | IPC validation, broker money-data, kill-switch gap, JSON.parse sweep — targeted pass + rerun checklist for uncovered areas | ready (partial scope — see its TLDR) |
| 03  | [AI capability parity](03-ai-capability-parity.md)   | Control-agent tool inventory vs full UI action surface (~15% covered); ranked gap list + 4 safety defects to fix first     | ready                                |
| 04  | [UI consistency](04-ui-consistency.md)               | Token discipline, duplicate primitives, native dialogs, formatters, loading/empty states, a11y                             | ready                                |
| 05  | [AI interface redesign](05-ai-interface-redesign.md) | Assistant slide-over/chat polish: 8 wiring bugs, markdown renderer, motion, history/full view                              | ready                                |

Suggested execution order across docs: 03 §5 safety defects → 05 bugs → 02 money-path items → 04 → 05 polish → 03 tool expansion.

Ground rules for the fixer AI:

- Verify every cited line before editing — the codebase moves; if a citation is stale, re-locate the pattern rather than blindly patching.
- Visual changes must be screenshotted in the running app (`scripts/ui-snap.ts`) and eyeballed — never declared done from code alone.
- Money-path changes (broker, risk, order policy) require running `bun run check` and `bun run test:smoke` before considering the change landed.
- Match existing repo conventions (`THEMING.md`, `docs/folder-structure.md`); do not introduce new libraries beyond those the docs explicitly call for.
