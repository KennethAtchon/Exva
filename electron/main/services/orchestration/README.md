# orchestration

Live trading cycle loop — schedules selector runs, trade pipelines, gates, and broker orders per session tick.

## Technical

- `cycle/agent-orchestrator.ts` drives the per-session queue.
- `TradingCycleContext` holds step runners and deps for one cycle.
- `policy/` — pre-trade validation; `lifecycle/` — start/stop and trade monitor.
