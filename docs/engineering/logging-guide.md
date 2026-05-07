# Logging Guide

## Goals

- Make production debugging faster with structured, searchable logs.
- Never log secrets, API keys, or full sensitive payloads.
- Keep logs meaningful: each line should help explain a state change, failure, or cost/risk decision.

## Current Setup

- Logger: `pino`
- Main logger factory: `electron/main/services/infra/log.ts`
- Output streams:
  - stdout (for local dev/runtime visibility)
  - file (`~/.exva/logs/exva-YYYY-MM-DD.log` by default)
- Retention: 7 days (startup pruning)
- Redaction: key fields such as `apiKey`, `secretKey`, `authorization`, and `password`

## Where To Log (Critical Paths)

- App lifecycle: startup, service wiring, shutdown hooks.
- IPC boundaries: channel, timing, payload metadata.
- Session runtime/orchestration: start, pause/resume, stop, cycle restarts, order placement outcomes.
- AI runtime: role start/end, token usage, latency, cost, finish reason.
- Risk engine: allow/deny reasons and any position resizing.
- Secrets handling: operation metadata only (existence/length), never values.

## Data Safety Rules

1. Never log raw secrets, tokens, API keys, cookies, auth headers, or prompt bodies.
2. For sensitive inputs, log metadata only:
   - presence (`true/false`)
   - approximate size (`length`/`bytes`)
   - detection flags (`sensitiveKeyDetected`, `looksSensitive`)
3. For long strings/payloads, log only lengths and `tooLong` booleans.
4. Do not log AI message content (we already persist AI traces elsewhere).
5. If a value could contain PII, prefer booleans/counters over excerpts.

## Message Quality Rules

1. Use clear event names in present tense (example: `"runtime started"`).
2. Include stable identifiers (`sessionId`, `tradeId`, `channel`) when available.
3. Log at decision boundaries, not every tiny step.
4. Include timing (`durationMs`) for IO-bound paths.
5. Include outcome fields (`allowed`, `reason`, `finishReason`) for debugability.

## Level Policy

- `error`: operation failed and user/system behavior is impacted.
- `warn`: operation completed with degraded behavior or guardrail rejection.
- `info`: major lifecycle milestones and business-important state transitions.
- `debug`: detailed diagnostics useful during development/investigation.
- `trace`: very high-volume diagnostics; use sparingly.

## Temporary Logs Policy

- Temporary investigation logs must include `TEMP` in the message.
  - Example: `logger.debug({ sessionId }, "TEMP selector payload shape")`
- Temporary logs must include a cleanup note in the PR description.
- Remove all `TEMP` logs before merge unless explicitly approved to keep.
- Cleanup sweep command:
  - `rg "TEMP" electron/main src`

## Adding New Logs (Contributor Checklist)

1. Is this a decision boundary, failure path, or lifecycle milestone?
2. Are identifiers included (without sensitive payloads)?
3. Could content include PII/secrets? If yes, convert to metadata only.
4. Is message text specific enough to grep later?
5. Is the log level appropriate?
6. If temporary, is `TEMP` included and a cleanup plan documented?

## Examples

Good:

```ts
logger.info({ sessionId, durationMs, allowed, reason }, "risk preflight evaluated");
logger.debug({ channel, payloadSizeBytes, sensitiveKeyDetected }, "ipc invoke start");
logger.info({ role, inputTokens, outputTokens, costUsd }, "ai role complete");
```

Bad:

```ts
logger.debug({ apiKey }, "provider key");
logger.info({ prompt }, "full ai prompt");
logger.debug({ payload }, "dump request");
```
