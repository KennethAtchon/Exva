import type { WorkspacePreferences } from "@/lib/types";
import { channels } from "./channels";
import { workspacePrefsPatchSchema } from "../validation/schemas";

export interface IpcEndpointDef<TInput> {
  channel: string;
  parseInput: (payload: unknown) => TInput;
}

export function defineEndpoint<TInput>(
  channel: string,
  parseInput: (payload: unknown) => TInput,
): IpcEndpointDef<TInput> {
  return { channel, parseInput };
}

export function invokeEndpoint<TInput, TOutput>(
  invoke: (channel: string, payload?: unknown) => Promise<TOutput>,
  endpoint: IpcEndpointDef<TInput>,
  input: TInput,
): Promise<TOutput> {
  return input === undefined
    ? invoke(endpoint.channel)
    : invoke(endpoint.channel, input);
}

export const workspaceEndpoints = {
  getView: defineEndpoint<undefined>(
    channels.workspace.viewGet,
    () => undefined,
  ),
  patchPreferences: defineEndpoint<Partial<Omit<WorkspacePreferences, "id">>>(
    channels.workspace.prefsPatch,
    (payload) => workspacePrefsPatchSchema.parse(payload ?? {}),
  ),
} as const;
