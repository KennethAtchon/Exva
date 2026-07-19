import type { z } from "zod";
import type { CapabilityRisk } from "@electron/shared/domain/control";
import type { AppServices } from "../app-services";

export type { CapabilityRisk };
export type CapabilityKind = "read" | "mutating";

export interface CapabilityContext {
  conversationId: string;
  scope: { kind: "workspace" | "session"; sessionId: string | null };
  /**
   * Capability keys pre-approved ("don't ask again") for this conversation.
   * May also contain legacy confirmClass strings from older conversations.
   */
  autoApproved: Set<string>;
}

export interface Capability<Input = unknown> {
  /** Registry key + tool name exposed to the model, e.g. "create_session". */
  key: string;
  /** Human label for ToolCallCard / ConfirmationCard headers. */
  label: string;
  kind: CapabilityKind;
  /**
   * Optional class for grouping related mutates. Auto-approve stores `key`;
   * confirmClass remains a legacy fallback match for older conversations.
   */
  confirmClass?: string;
  /**
   * Forces confirmation even when the capability was auto-approved (trades, live broker).
   * May be a predicate when the gate depends on input (e.g. approve vs reject).
   */
  alwaysConfirm?: boolean | ((input: Input, services: AppServices) => boolean);
  /** Fed to the model. */
  description: string;
  inputSchema: z.ZodType<Input>;
  /** One-line human preview of what this call will do. Powers card summaries. */
  describe(input: Input, services: AppServices): string;
  /** Marks the touched entity for the audit log, e.g. `session:${input.id}`. */
  affectedEntity?(input: Input): string | null;
  /** Optional structured risk (live/normal) shown on the ConfirmationCard. */
  risk?(input: Input, services: AppServices): CapabilityRisk | null;
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
