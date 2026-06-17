// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const renameMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const refetchMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const closeMock = vi.hoisted(() => vi.fn());

vi.mock("@/store/controlStore", () => ({
  useControlStore: (selector: (state: unknown) => unknown) =>
    selector({
      slideOverOpen: true,
      closeSlideOver: closeMock,
    }),
}));

vi.mock("@/hooks/useControlConversations", () => ({
  useControlConversations: () => ({
    activeId: "conversation-1",
    createNew: vi.fn(),
    rename: renameMock,
  }),
}));

vi.mock("@/hooks/useControlConversation", () => ({
  useControlConversation: () => ({
    conversation: {
      id: "conversation-1",
      title: "Renamed session helper",
      scopeKind: "workspace",
      scopeSessionId: null,
      autoApproved: [],
      createdAt: "2026-06-16T00:00:00.000Z",
      updatedAt: "2026-06-16T00:00:00.000Z",
    },
    items: [],
    error: null,
    streaming: false,
    confirm: vi.fn(),
    reject: vi.fn(),
    send: vi.fn(),
    cancel: vi.fn(),
    refetch: refetchMock,
  }),
}));

vi.mock("@/store/workspaceStore", () => ({
  useWorkspaceStore: (selector: (state: unknown) => unknown) =>
    selector({
      preferences: {
        defaultModelProviderKey: "openrouter",
        defaultModelModelId: "google/gemini-2.5-pro",
      },
    }),
}));

vi.mock("@/components/control/ConversationView", () => ({
  ConversationTranscript: () => createElement("div", null, "transcript"),
  Composer: () => createElement("div", null, "composer"),
}));

vi.mock("@/components/control/ScopeChip", () => ({
  ScopeChip: () => null,
}));

import { AssistantSlideOver } from "@/components/control/AssistantSlideOver";
import { MarkdownContent } from "@/components/control/MarkdownContent";

describe("assistant UI", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    renameMock.mockClear();
    refetchMock.mockClear();
    closeMock.mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders markdown structure for assistant replies", () => {
    act(() => {
      root.render(
        createElement(MarkdownContent, {
          content:
            "## Action plan\n- Check risk\n- Pause the session\n\nUse **bold** and `code`.",
        }),
      );
    });

    expect(container.querySelector("h2")?.textContent).toBe("Action plan");
    expect(
      Array.from(container.querySelectorAll("li")).map(
        (item) => item.textContent,
      ),
    ).toEqual(["Check risk", "Pause the session"]);
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("code")?.textContent).toBe("code");
  });

  it("shows the active conversation title, model, and search-tool status in the slide-over", async () => {
    const promptMock = vi.fn(() => "Desk ops");
    window.prompt = promptMock;

    act(() => {
      root.render(
        createElement(AssistantSlideOver, {
          onOpenFullView: vi.fn(),
        }),
      );
    });

    expect(container.textContent).toContain("Renamed session helper");
    expect(container.textContent).toContain(
      "openrouter / google/gemini-2.5-pro",
    );
    expect(container.textContent).toContain("Web search off");

    const renameButton = container.querySelector(
      'button[title="Rename conversation"]',
    ) as HTMLButtonElement | null;
    expect(renameButton).not.toBeNull();

    await act(async () => {
      renameButton?.click();
      await Promise.resolve();
    });

    expect(promptMock).toHaveBeenCalledWith(
      "Rename conversation",
      "Renamed session helper",
    );
    expect(renameMock).toHaveBeenCalledWith("conversation-1", "Desk ops");
    expect(refetchMock).toHaveBeenCalledOnce();
  });
});
