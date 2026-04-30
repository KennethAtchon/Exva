# Phase 10 — Services Layer Refactor

> Split the flat `electron/main/services/` directory into domain subfolders.
> Pure structural refactor — no behavioral changes.

## Goal

As services multiply across phases 5–9, the flat `services/` directory becomes hard to navigate. This phase reorganizes into domain-scoped modules that match the mental model of the system.

## Hard Problems

None — this is mechanical reorganization. The risks are:
1. **Import path breakage** — every file that imports from `services/` must be updated. Use find-and-replace with verification.
2. **Circular imports** — domain subfolders must not import from each other except through explicit interfaces. Use the dependency rules below.

## Target Directory Structure

```
electron/main/
├── broker/
│   ├── broker-adapter.ts           (interface — unchanged)
│   ├── alpaca-adapter.ts           (unchanged)
│   ├── mock-adapter.ts             (unchanged)
│   └── broker-registry.ts          (Phase 8 — move here if not already)
├── db/
│   ├── client.ts                   (unchanged)
│   ├── migrations.ts               (unchanged)
│   ├── schema.ts                   (unchanged)
│   └── repositories/               (unchanged structure)
├── ipc/
│   ├── accounts.ts
│   ├── approvals.ts
│   ├── config.ts
│   ├── dashboard.ts
│   ├── events.ts
│   ├── handle.ts
│   ├── register.ts
│   ├── session.ts
│   ├── templates.ts
│   ├── trades.ts
│   └── workspace.ts
├── prompts/
│   └── *.md
├── services/
│   ├── ai/
│   │   ├── provider-adapter.ts
│   │   ├── anthropic-adapter.ts
│   │   ├── openai-adapter.ts
│   │   ├── opencode-adapter.ts
│   │   ├── provider-registry.ts
│   │   ├── provider-model-catalog.ts
│   │   ├── ai-runtime.ts
│   │   └── prompt-asset-loader.ts
│   ├── broker/
│   │   └── broker-routing-service.ts
│   ├── instrument/
│   │   └── instrument-cache-service.ts  (wraps InstrumentCacheRepo)
│   ├── risk/
│   │   └── risk-engine.ts              (move from root services/)
│   ├── session/
│   │   └── session-service.ts          (move from root services/)
│   ├── agent-orchestrator.ts           (stays at root — it ties everything together)
│   ├── app-services.ts                 (unchanged — wires everything)
│   ├── event-bus.ts                    (stays at root)
│   ├── notification-service.ts         (stays at root)
│   ├── secrets-service.ts              (stays at root — cross-cutting)
│   └── trade-monitor.ts               (stays at root)
```

## Dependency Rules

These rules prevent circular imports:

```
ai/ → shared/domain, db/repositories, secrets-service
broker/ → shared/domain, db/repositories, secrets-service, broker/adapters
risk/ → shared/domain, db/repositories
session/ → shared/domain, db/repositories, broker/, ai/, risk/
instrument/ → shared/domain, db/repositories, ai/
agent-orchestrator → session/, ai/, broker/, instrument/, risk/, event-bus
ipc/ → services/ (any domain subfolder)
```

No domain subfolder imports from `agent-orchestrator` or `ipc/`.

## Migration Steps

1. **Create subdirectories** (no file moves yet).
2. **Move files** using `mv` or equivalent — one domain at a time.
3. **Update imports** in all files that reference moved paths.
4. **Verify TypeScript compilation** after each domain move before proceeding.
5. **Run the app** and verify no runtime import errors.

## File Moves

| From | To |
|------|----|
| `services/ai-sdk-service.ts` | deleted in Phase 7 |
| `services/risk-engine.ts` | `services/risk/risk-engine.ts` |
| `services/session-service.ts` | `services/session/session-service.ts` |
| `services/prompt-asset-loader.ts` | `services/ai/prompt-asset-loader.ts` |
| `services/provider-model-catalog.ts` | `services/ai/provider-model-catalog.ts` |
| `broker/broker-registry.ts` | stays at `broker/broker-registry.ts` |

Files that stay at `services/` root (cross-cutting, no natural subdomain):
- `agent-orchestrator.ts`
- `app-services.ts`
- `event-bus.ts`
- `notification-service.ts`
- `secrets-service.ts`
- `trade-monitor.ts`

## `app-services.ts` After Refactor

The wiring file stays at root but imports from subdirectories:

```typescript
import { AiRuntime } from "./ai/ai-runtime";
import { ProviderRegistry } from "./ai/provider-registry";
import { PromptAssetLoader } from "./ai/prompt-asset-loader";
import { BrokerRegistry } from "../broker/broker-registry";
import { BrokerRoutingService } from "./broker/broker-routing-service";
import { RiskEngine } from "./risk/risk-engine";
import { SessionService } from "./session/session-service";
import { AgentOrchestrator } from "./agent-orchestrator";
// ...
```

## Import Path Aliases

Add path aliases to `tsconfig.json` so imports don't become `../../` chains:

```json
{
  "compilerOptions": {
    "paths": {
      "@main/*": ["./electron/main/*"],
      "@shared/*": ["./electron/shared/*"],
      "@/*": ["./src/*"]
    }
  }
}
```

Update `vite.main.config.ts` to resolve these aliases:

```typescript
resolve: {
  alias: {
    "@main": path.resolve(__dirname, "electron/main"),
    "@shared": path.resolve(__dirname, "electron/shared"),
    "@": path.resolve(__dirname, "src"),
  }
}
```

## Grep Checklist — No Broken Imports After This Phase

```bash
# Verify no import still points at old flat service paths
grep -r "from.*services/ai-sdk-service" electron/ --include="*.ts"
grep -r "from.*services/risk-engine" electron/ --include="*.ts"
grep -r "from.*services/session-service" electron/ --include="*.ts"
grep -r "from.*services/prompt-asset-loader" electron/ --include="*.ts"
```

All above must return zero results.

## Verification Order

1. Move `risk/` files → compile.
2. Move `session/` files → compile.
3. Move `ai/` files → compile.
4. Move `broker/` routing file → compile.
5. Start the app with a configured session, start/stop the session → verify no runtime errors.

## Files Created / Modified

| Action | File |
|--------|------|
| Create | `electron/main/services/risk/` directory |
| Move | `services/risk-engine.ts` → `services/risk/risk-engine.ts` |
| Create | `electron/main/services/session/` directory |
| Move | `services/session-service.ts` → `services/session/session-service.ts` |
| Create | `electron/main/services/instrument/` directory |
| Create | `services/instrument/instrument-cache-service.ts` |
| Modify | All files importing moved modules — update import paths |
| Modify | `tsconfig.json` — add path aliases |
| Modify | `vite.main.config.ts` — add alias resolution |
| Modify | `electron/main/services/app-services.ts` — update import paths |

## Acceptance Criteria

- TypeScript compiles with zero errors after all file moves.
- No `../../` path depth greater than 3 levels exists in any import within `services/`.
- Path aliases (`@main/`, `@shared/`) resolve correctly in both `tsc` and Vite builds.
- App starts, session can be created, started, and stopped with no runtime import errors.
- All grep checks in the checklist above return zero results.
