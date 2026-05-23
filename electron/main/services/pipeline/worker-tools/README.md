# pipeline/worker-tools

Assembles the callable tool set each worker is allowed to use during its run.

## Technical

- `worker-tool-factory.ts` — `buildWorkerTools`, submit-output tool wiring.
- `worker-tool-resolver.ts` — `resolveWorkerToolContext` for session-scoped deps.
