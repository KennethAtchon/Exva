# Phase 6 — Config diet (deferred landing note)

Status: **not executed as a schema migration**. Phases 0–5 are stable first.

## Target (when pain warrants it)

Nine session-config tables + five preset tables → one versioned
`session_strategy_config` JSON document validated by Zod. Presets write
documents instead of rows-per-table.

## Why deferred

- Churn-heavy and user-visible
- Nothing in Phases 0–5 depends on it
- Plan §9.10: only after 0–5 stable

## When to pick up

Operator pain from 9-table IPC/UI surface exceeds cost of a measured migration
with dual-read. Until then, leave tables as-is.
