# Logging Guide

> **Authority:** This guide owns log safety and event-shape rules. The complete
> field, correlation, retention, and evidence-bundle contract is in
> [Observability Contract](./observability-guide.md).
> **Last verified:** 2026-07-21.

## Current Setup

| Capability                    | Implementation                                                 | State                                                                                               |
| ----------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Logger                        | Pino via `electron/main/services/infra/log.ts`                 | **Implemented**                                                                                     |
| Scope                         | `createLogger(scope)` child field                              | **Implemented**                                                                                     |
| Outputs                       | stdout and daily `exva-YYYY-MM-DD.log` files                   | **Implemented**                                                                                     |
| Directory                     | `EXVA_LOG_DIR` or `~/.exva/logs`                               | **Implemented**                                                                                     |
| Retention                     | Seven local calendar days, pruned at startup and date rotation | **Implemented**                                                                                     |
| Levels                        | `error`, `warn`, `info`, `debug`, `trace` via `EXVA_LOG_LEVEL` | **Implemented**                                                                                     |
| Runtime level/scope controls  | Developer Workbench settings                                   | **Partial:** global override changes Pino levels and expires; targeted scope controls remain absent |
| Cross-process trace IDs       | Preload, IPC, main, utility                                    | **Partial:** W3C context and request IDs propagate; durable/provider correlation remains incomplete |
| Sink health/dropped-log count | File/stdout destinations                                       | **Required**                                                                                        |

## Current Safety Baseline

`run-agent-execute.ts` logs metadata and sizes rather than prompts, tool payloads,
reasoning, or responses. Provider retry logs retain allowlisted status, code, and
classification without raw provider messages, bodies, or cause chains. Tests
cover named sensitive content, but comprehensive retained-sink scanning is still
required before ordinary logs are treated as independently shareable artifacts.

## Data Safety Rules

1. Never write raw secrets, credentials, auth headers, cookies, environment
   values, prompt/message bodies, reasoning, tool arguments/results, provider
   response bodies, or user PII to ordinary logs.
2. Record metadata: presence, byte/character count, schema name, allowlisted enum,
   stable ID, content hash, truncation flag, and sensitivity-detection result.
3. Hashes prove equality, not safety. Never hash low-entropy secrets as a way to
   make them loggable.
4. Treat external error text as untrusted and potentially sensitive. Store an
   allowlisted provider code/status and sanitize the message and stack. Raw Pino
   `err` serialization is allowed only for trusted internal errors whose message
   and stack cannot contain provider/user content.
5. Persisted AI audit content is not permission to duplicate it into logs or a
   support bundle.
6. Content capture, if ever needed, uses a separate opt-in artifact with a short
   lifetime, byte limit, preview, encryption/permissions, and deletion workflow.
7. All log fields derived from users/providers are sanitized against CR/LF and
   control-character injection before text rendering.

## Event Shape

Use a stable machine event name. Human prose is context, not identity.

```ts
logger.info(
  {
    eventName: "risk.preflight.completed",
    schemaVersion: 1,
    traceId,
    spanId,
    bootId,
    sessionId,
    cycleId,
    component: "risk",
    operation: "preflight",
    outcome: allowed ? "ok" : "rejected",
    durationMs,
    reasonCode,
  },
  "risk preflight completed",
);
```

Required fields and their types are defined in the
[Universal Telemetry Envelope](./observability-guide.md#5-universal-telemetry-envelope).
Use `err` only for trusted internal Error objects. For dependency errors, emit a
sanitized error object with an allowlisted type/code, scrubbed message/stack, and
provider request ID. Pino key-path redaction does not sanitize secret text inside
`err.message` or `err.stack`.

## Level Policy

| Level            | Use                                                                                                                                      | Do not use for                               |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `critical` event | Safety invariant violated or immediate human action required. Persist to the domain event surface; Pino has no separate policy here yet. | Ordinary provider failure.                   |
| `error`          | Operation failed, timed out, crashed, or ended in unknown state.                                                                         | Expected guardrail rejection.                |
| `warn`           | Degraded success, fallback, retry, stale data, or expected business rejection worth investigation.                                       | Every routine negative decision.             |
| `info`           | App/session lifecycle, durable business transition, external side effect, configuration change.                                          | Prompt bodies or per-token/per-chunk detail. |
| `debug`          | Bounded operation diagnostics needed during investigation.                                                                               | Evidence required after production failure.  |
| `trace`          | High-volume, short-lived local diagnosis.                                                                                                | Default operation or sensitive content.      |

If diagnosis requires a level that was disabled when the failure happened, the
required durable signal is missing. Promote the specific outcome signal rather
than permanently increasing global verbosity.

## What Must Be Logged

| Boundary          | Start/end evidence                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| App/process       | Boot ID, immutable build fingerprint, stage, ready, shutdown, crash/exit reason.                    |
| Renderer          | Route/bootstrap ready, global exception/rejection, load failure, crash, hang/recovery.              |
| IPC               | Invocation ID, channel, deadline, payload bytes, validation, duration, outcome.                     |
| Utility process   | Worker identity, request ID, queue/deadline, heartbeat, exit/restart, last operation.               |
| Database          | Operation/table, transaction ID, duration, rows, busy retry, integrity/checkpoint outcome.          |
| Scheduler/feed    | Due time, actual fire/lateness, result counts, freshness, next run, missed fire.                    |
| LLM/tool/provider | Attempt, provider/model/endpoint, safe input hash/size, latency, tokens/cost, code, retry/fallback. |
| Broker            | Client/provider order IDs, requested/filled amount, status, retry/reconciliation, final outcome.    |
| Configuration     | Actor/source, old/new version/hash, reason, trace ID; never raw secret values.                      |
| Telemetry itself  | Sink open/rotate/flush failure, dropped count, queue depth, free disk, bundle omissions.            |

Every started operation must terminate with `ok`, `error`, `cancelled`, `timeout`,
`degraded`, `rejected`, or `unknown`. A missing terminal event is detected by a
deadline or stale-work monitor.

## Good and Bad Examples

Good:

```ts
logger.info(
  {
    eventName: "llm.invoke.completed",
    traceId,
    spanId,
    sessionId,
    cycleId,
    role,
    provider,
    requestedModel,
    responseModel,
    promptHash,
    promptChars,
    inputTokens,
    outputTokens,
    costUsd,
    durationMs,
    finishReason,
    outcome: "ok",
  },
  "LLM invocation completed",
);
```

Bad:

```ts
logger.debug({ apiKey }, "provider key");
logger.info({ systemPrompt, userPrompt }, "agent prompt");
logger.info({ toolArgs, toolResult }, "agent tool call");
logger.info({ reasoning, responseText }, "agent completed");
logger.debug({ payload }, "dump request");
```

## Temporary Diagnostics

1. Prefer a trace/span attribute or targeted failure-injection test over a
   temporary log.
2. If needed, include `TEMP` in the message and use `debug` or `trace`.
3. Never relax the safety rules, even locally.
4. Remove the record before merge unless it becomes a contracted event with a
   stable name, schema, test, and retention decision.
5. Sweep with `rg "TEMP" electron/main src`.

## Verification Gate

Any logging change must test emitted output, not just mock `logger.info`:

- expected event name, level, fields, types, and correlation IDs;
- error, timeout, cancellation, retry, fallback, and degraded outcomes;
- nested, case-varied, and free-text secret fixtures are absent;
- long/unserializable payload behavior is bounded;
- sink error or disk-full behavior is visible through a fallback path;
- log rotation and retention do not lose the active date boundary.
