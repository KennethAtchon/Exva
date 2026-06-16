import type { z } from "zod";
import type { AppServices } from "../app-services";

export type CapabilityKind = "read" | "mutating";

export interface CapabilityContext {
  conversationId: string;
  scope: { kind: "workspace" | "session"; sessionId: string | null };
  /** Capability-class keys pre-approved ("don't ask again") for this conversation. */
  autoApproved: Set<string>;
}

export interface Capability<Input = unknown> {
  /** Registry key + tool name exposed to the model, e.g. "create_session". */
  key: string;
  /** Human label for ToolCallCard / ConfirmationCard headers. */
  label: string;
  kind: CapabilityKind;
  /** For mutating caps: class key used by the "don't ask again" opt-in. */
  confirmClass?: string;
  /** Forces confirmation even when the class was auto-approved (trades, live broker). */
  alwaysConfirm?: boolean;
  /** Fed to the model. */
  description: string;
  inputSchema: z.ZodType<Input>;
  /** One-line human preview of what this call will do. Powers card summaries. */
  describe(input: Input, services: AppServices): string;
  /** Marks the touched entity for the audit log, e.g. `session:${input.id}`. */
  affectedEntity?(input: Input): string | null;
  /** Optional risk note (e.g. live-broker warning) shown on the ConfirmationCard. */
  risk?(input: Input, services: AppServices): string | null;
  /** Delegates to existing AppServices methods — never reaches into the DB directly. */
  execute(
    input: Input,
    services: AppServices,
    ctx: CapabilityContext,
  ): Promise<unknown> | unknown;
}

/** Helper to declare a capability with input type inference. */
export function defineCapability<Input>(
  cap: Capability<Input>,
): Capability<unknown> {
  return cap as unknown as Capability<unknown>;
}
