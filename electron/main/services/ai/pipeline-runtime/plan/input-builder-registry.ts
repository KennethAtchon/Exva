import type { InstrumentClass, WorkspaceSession } from "@/lib/types";
import type { ToolBuildContext } from "../context/tool-factory-registry";
import type { PhasePlanServices } from "./phase-plan-services";

export type InputBuilderId = string;

export interface InputBuilderContext {
  sessionId: string;
  session: WorkspaceSession;
  instrumentClasses: InstrumentClass[];
  toolContext: ToolBuildContext;
  services: PhasePlanServices;
}

export interface InputBuilder {
  id: InputBuilderId;
  build(ctx: InputBuilderContext): Promise<string | null>;
}

const INPUT_BUILDERS = new Map<InputBuilderId, InputBuilder>();

export function registerInputBuilder(builder: InputBuilder): void {
  INPUT_BUILDERS.set(builder.id, builder);
}

export function getInputBuilder(id: InputBuilderId): InputBuilder {
  const builder = INPUT_BUILDERS.get(id);
  if (!builder) throw new Error(`Input builder '${id}' is not registered`);
  return builder;
}

export async function buildCompositeInput(
  builderIds: readonly InputBuilderId[],
  ctx: InputBuilderContext,
): Promise<string> {
  const sections: string[] = [];
  for (const builderId of builderIds) {
    const section = await getInputBuilder(builderId).build(ctx);
    if (section) sections.push(section);
  }
  return sections.filter(Boolean).join("\n\n");
}
