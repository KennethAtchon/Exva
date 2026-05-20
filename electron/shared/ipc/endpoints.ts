import type { WorkspacePreferences } from "@/lib/types";
import type { WorkspaceViewResponse } from "./dto";
import { channels } from "./channels";
import { workspacePrefsPatchSchema } from "../validation/schemas";

export interface IpcEndpointDef<TInput, TOutput> {
  channel: string;
  parseInput: (payload: unknown) => TInput;
}

export function defineEndpoint<TInput, TOutput>(
  channel: string,
  parseInput: (payload: unknown) => TInput,
): IpcEndpointDef<TInput, TOutput> {
  return { channel, parseInput };
}

export function invokeEndpoint<TInput, TOutput>(
  invoke: (channel: string, payload?: unknown) => Promise<TOutput>,
  endpoint: IpcEndpointDef<TInput, TOutput>,
  input: TInput,
): Promise<TOutput> {
  return input === undefined ? invoke(endpoint.channel) : invoke(endpoint.channel, input);
}

export const workspaceEndpoints = {
  getView: defineEndpoint<undefined, WorkspaceViewResponse>(channels.workspace.viewGet, () => undefined),
  patchPreferences: defineEndpoint<Partial<Omit<WorkspacePreferences, "id">>, WorkspacePreferences>(
    channels.workspace.prefsPatch,
    (payload) => workspacePrefsPatchSchema.parse(payload ?? {}),
  ),
} as const;
