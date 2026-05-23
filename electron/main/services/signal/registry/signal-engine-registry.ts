import type { EngineId } from "@electron/shared/ai/ai-phase";
import type { AnySignalEngine } from "./types";

const ENGINE_REGISTRY = new Map<EngineId, AnySignalEngine>();

export function registerSignalEngine(definition: AnySignalEngine): void {
  ENGINE_REGISTRY.set(definition.id, definition);
}

export function getSignalEngine(id: EngineId): AnySignalEngine | undefined {
  return ENGINE_REGISTRY.get(id);
}

export function requireEngine(id: EngineId): AnySignalEngine {
  const engine = getSignalEngine(id);
  if (!engine) throw new Error(`Engine '${id}' is not registered`);
  return engine;
}
