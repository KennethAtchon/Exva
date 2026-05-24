# orchestration/cycle/scheduling

Manages how selector output turns into queued work. This is where the live loop tracks which instruments are waiting, active, or freed up after a trade closes.

## Technical

- `instrument-queue.ts` manages the queue state.
- `trade-closed-handler.ts` listens for close events so the orchestrator can refill capacity.

## Terms

- **Queue slot** — one available unit of concurrent trade-analysis capacity.
