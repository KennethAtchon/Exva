import type { EngineId } from "@electron/shared/ai/pipeline-phase";
import type { AnyEngineDefinition } from "./types";

const ENGINE_REGISTRY = new Map<EngineId, AnyEngineDefinition>();

export function registerEngine(definition: AnyEngineDefinition): void {
  ENGINE_REGISTRY.set(definition.id, definition);
}

export function getEngine(id: EngineId): AnyEngineDefinition | undefined {
  return ENGINE_REGISTRY.get(id);
}

export function requireEngine(id: EngineId): AnyEngineDefinition {
  const engine = getEngine(id);
  if (!engine) throw new Error(`Engine '${id}' is not registered`);
  return engine;
}
