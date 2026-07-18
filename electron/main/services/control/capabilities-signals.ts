import { z } from "zod";
import { defineCapability } from "./capability";
import { CONFIRM_CLASS } from "./capabilities-shared";
import { resolveSession } from "./resolve-session";

const signalSourceTypeSchema = z.enum([
  "edgar_8k",
  "manual",
  "prediction_event",
  "mock",
]);

export const createSignalSource = defineCapability<{
  type: z.infer<typeof signalSourceTypeSchema>;
  name: string;
  description?: string | null;
  config?: Record<string, unknown>;
}>({
  key: "create_signal_source",
  label: "Create signal source",
  kind: "mutating",
  confirmClass: CONFIRM_CLASS.signalWrite,
  description:
    "Create a signal source (edgar_8k, manual, prediction_event, mock).",
  inputSchema: z.object({
    type: signalSourceTypeSchema,
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    config: z.record(z.unknown()).optional(),
  }),
  describe: (input) => `Create ${input.type} signal source "${input.name}".`,
  execute: async (input, services) => {
    const source = await services.signals.createSource(input);
    return {
      id: source.id,
      type: source.type,
      name: source.name,
      enabled: source.enabled,
    };
  },
});

export const updateSignalSource = defineCapability<{
  id: string;
  name?: string;
  description?: string | null;
  enabled?: boolean;
  config?: Record<string, unknown>;
}>({
  key: "update_signal_source",
  label: "Update signal source",
  kind: "mutating",
  confirmClass: CONFIRM_CLASS.signalWrite,
  description:
    "Update a signal source's name, description, enabled, or config.",
  inputSchema: z.object({
    id: z.string().min(1),
    name: z.string().optional(),
    description: z.string().nullable().optional(),
    enabled: z.boolean().optional(),
    config: z.record(z.unknown()).optional(),
  }),
  describe: (input) => `Update signal source ${input.id}.`,
  affectedEntity: (input) => `signal_source:${input.id}`,
  execute: async (input, services) => {
    const { id, ...patch } = input;
    const source = await services.signals.updateSource(id, patch);
    return {
      id: source.id,
      name: source.name,
      enabled: source.enabled,
    };
  },
});

export const deleteSignalSource = defineCapability<{ id: string }>({
  key: "delete_signal_source",
  label: "Delete signal source",
  kind: "mutating",
  confirmClass: CONFIRM_CLASS.signalWrite,
  alwaysConfirm: (input, services) => {
    const source = services.signals
      .listSources()
      .find((s) => s.id === input.id);
    return (source?.attachedSessionCount ?? 0) > 0;
  },
  description:
    "Delete a signal source by id. Always confirms when sessions are attached.",
  inputSchema: z.object({ id: z.string().min(1) }),
  describe: (input, services) => {
    const source = services.signals
      .listSources()
      .find((s) => s.id === input.id);
    const n = source?.attachedSessionCount ?? 0;
    return n > 0
      ? `Delete signal source ${input.id} (attached to ${n} session(s)).`
      : `Delete signal source ${input.id}.`;
  },
  affectedEntity: (input) => `signal_source:${input.id}`,
  execute: async (input, services) => {
    await services.signals.deleteSource(input.id);
    return { ok: true, id: input.id };
  },
});

export const testSignalSource = defineCapability<{ id: string }>({
  key: "test_signal_source",
  label: "Test signal source",
  kind: "read",
  description: "Poll/test a signal source without mutating enablement.",
  inputSchema: z.object({ id: z.string().min(1) }),
  describe: (input) => `Test signal source ${input.id}.`,
  execute: async (input, services) => {
    const result = await services.signals.testSource(input.id);
    return { result };
  },
});

export const listSessionSignalEvents = defineCapability<{
  session: string;
  statusBucket?: "pending" | "completed" | "dropped";
  limit?: number;
}>({
  key: "list_session_signal_events",
  label: "List session signal events",
  kind: "read",
  description: "List recent signal delivery events for a session.",
  inputSchema: z.object({
    session: z.string().min(1),
    statusBucket: z.enum(["pending", "completed", "dropped"]).optional(),
    limit: z.number().int().positive().max(100).optional(),
  }),
  describe: (input) =>
    `List signal events for "${input.session}" (limit ${input.limit ?? 40}).`,
  execute: (input, services) => {
    const session = resolveSession(services, input.session);
    const rows = services.signals.listEventsBySession({
      sessionId: session.id,
      statusBucket: input.statusBucket,
      limit: input.limit ?? 40,
    });
    return {
      count: rows.length,
      rows: rows.slice(0, input.limit ?? 40).map((r) => ({
        id: r.delivery.id,
        status: r.delivery.status,
        statusBucket: r.delivery.statusBucket,
        signalEventId: r.delivery.signalEventId,
        sourceId: r.delivery.sourceId,
        createdAt: r.delivery.enqueuedAt,
      })),
    };
  },
});

export const listDeadLetters = defineCapability<{
  session: string;
  limit?: number;
}>({
  key: "list_dead_letters",
  label: "List signal dead letters",
  kind: "read",
  description: "List undeliverable signal dead letters for a session.",
  inputSchema: z.object({
    session: z.string().min(1),
    limit: z.number().int().positive().max(100).optional(),
  }),
  describe: (input) => `List dead letters for "${input.session}".`,
  execute: (input, services) => {
    const session = resolveSession(services, input.session);
    const rows = services.signals.listDeadLettersBySession({
      sessionId: session.id,
      limit: input.limit ?? 40,
    });
    return {
      count: rows.length,
      rows: rows.slice(0, input.limit ?? 40).map((r) => ({
        id: r.deadLetter.id,
        reason: r.deadLetter.reason,
        signalEventId: r.deadLetter.signalEventId,
        ticker: r.deadLetter.ticker,
        createdAt: r.deadLetter.createdAt,
        replayedAt: r.deadLetter.replayedAt,
      })),
    };
  },
});

export const replayDeadLetter = defineCapability<{ deadLetterId: string }>({
  key: "replay_dead_letter",
  label: "Replay dead letter",
  kind: "mutating",
  confirmClass: CONFIRM_CLASS.signalWrite,
  description: "Replay a signal dead letter by id.",
  inputSchema: z.object({ deadLetterId: z.string().min(1) }),
  describe: (input) => `Replay dead letter ${input.deadLetterId}.`,
  affectedEntity: (input) => `dead_letter:${input.deadLetterId}`,
  execute: (input, services) =>
    services.signals.replayDeadLetter(input.deadLetterId),
});
