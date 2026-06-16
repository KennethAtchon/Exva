import { randomUUID } from "node:crypto";
import { ipcMain } from "electron";
import { AppError } from "@electron/shared/infra/errors";
import { channels } from "@electron/shared/ipc/channels";
import type { ControlScopeKind } from "@electron/shared/domain/control";
import { handle } from "./handle";
import type { AppServices } from "../services/app-services";

export function registerControlHandlers(services: AppServices): void {
  const { control, controlRepo } = services;

  handle(ipcMain, channels.control.isEnabled, async () => ({
    enabled: control.isEnabled(),
  }));

  handle(ipcMain, channels.control.listConversations, async () => ({
    conversations: controlRepo.listConversations(),
  }));

  handle(ipcMain, channels.control.getConversation, async (payload) => {
    const { id } = payload as { id: string };
    return {
      conversation: controlRepo.requireConversation(id),
      messages: controlRepo.listMessages(id),
      toolCalls: controlRepo.listToolCalls(id),
    };
  });

  handle(ipcMain, channels.control.createConversation, async (payload) => {
    const input = (payload ?? {}) as {
      title?: string;
      scopeKind?: ControlScopeKind;
      scopeSessionId?: string | null;
    };
    const scopeKind: ControlScopeKind =
      input.scopeKind === "session" ? "session" : "workspace";
    const scopeSessionId =
      scopeKind === "session" ? (input.scopeSessionId ?? null) : null;
    const conversation = controlRepo.createConversation({
      id: randomUUID(),
      title: input.title?.trim() || "New conversation",
      scopeKind,
      scopeSessionId,
    });
    return { conversation };
  });

  handle(ipcMain, channels.control.renameConversation, async (payload) => {
    const { id, title } = payload as { id: string; title: string };
    if (!title.trim()) {
      throw new AppError("Title cannot be empty.", "VALIDATION_FAILED");
    }
    controlRepo.renameConversation(id, title.trim());
    return { ok: true as const };
  });

  handle(ipcMain, channels.control.deleteConversation, async (payload) => {
    const { id } = payload as { id: string };
    control.cancel(id);
    controlRepo.deleteConversation(id);
    return { ok: true as const };
  });

  handle(ipcMain, channels.control.send, async (payload) => {
    const { conversationId, message } = payload as {
      conversationId: string;
      message: string;
    };
    if (!control.isEnabled()) {
      throw new AppError("The assistant is disabled.", "VALIDATION_FAILED");
    }
    if (!message.trim()) {
      throw new AppError("Message cannot be empty.", "VALIDATION_FAILED");
    }
    return control.startTurn({ conversationId, message: message.trim() });
  });

  handle(ipcMain, channels.control.confirm, async (payload) => {
    const { conversationId, toolCallId, alwaysApprove } = payload as {
      conversationId: string;
      toolCallId: string;
      alwaysApprove?: boolean;
    };
    control.resolveConfirmation({
      conversationId,
      toolCallId,
      decision: "confirm",
      alwaysApprove,
    });
    return { ok: true as const };
  });

  handle(ipcMain, channels.control.reject, async (payload) => {
    const { conversationId, toolCallId } = payload as {
      conversationId: string;
      toolCallId: string;
    };
    control.resolveConfirmation({
      conversationId,
      toolCallId,
      decision: "reject",
    });
    return { ok: true as const };
  });

  handle(ipcMain, channels.control.cancel, async (payload) => {
    const { conversationId } = payload as { conversationId: string };
    control.cancel(conversationId);
    return { ok: true as const };
  });

  handle(ipcMain, channels.control.getActivity, async () => ({
    toolCalls: controlRepo.listMutatingToolCalls(),
  }));
}
