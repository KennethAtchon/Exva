// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const renameMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const removeMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const refreshMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const refetchMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const closeMock = vi.hoisted(() => vi.fn());

vi.mock("@/store/controlStore", () => ({
  useControlStore: (selector: (state: unknown) => unknown) =>
    selector({
      slideOverOpen: true,
      closeSlideOver: closeMock,
      draftsByConversationId: {},
      setDraft: vi.fn(),
    }),
}));

vi.mock("@/hooks/useControlConversations", () => ({
  useControlConversations: () => ({
    conversations: [
      {
        id: "conversation-1",
        title: "Renamed session helper",
        scopeKind: "workspace",
        scopeSessionId: null,
        messageCount: 2,
        updatedAt: "2026-06-16T00:00:00.000Z",
      },
    ],
    activeId: "conversation-1",
    setActive: vi.fn(),
    createNew: vi.fn(),
    rename: renameMock,
    remove: removeMock,
    refresh: refreshMock,
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

vi.mock("@/components/docs/DocMermaid", () => ({
  DocMermaid: ({ chart }: { chart: string }) =>
    createElement("div", { "data-testid": "mermaid" }, chart),
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
    removeMock.mockClear();
    refreshMock.mockClear();
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

  it("renders gfm tables and keeps incomplete fences contained", () => {
    act(() => {
      root.render(
        createElement(MarkdownContent, {
          content:
            "| Symbol | Qty |\n| --- | --- |\n| NVDA | 2 |\n\n```ts\nconst x = 1",
        }),
      );
    });

    expect(container.querySelector("table")).not.toBeNull();
    expect(container.textContent).toContain("NVDA");
    expect(container.textContent).toContain("Streaming…");
    expect(container.textContent).toContain("const x = 1");
  });

  it("renders mermaid fences via DocMermaid", () => {
    act(() => {
      root.render(
        createElement(MarkdownContent, {
          content: "```mermaid\ngraph TD\n  A-->B\n```",
        }),
      );
    });

    const mermaid = container.querySelector('[data-testid="mermaid"]');
    expect(mermaid?.textContent).toContain("graph TD");
  });

  it("shows the active conversation title; model lives in settings popover", async () => {
    const promptMock = vi.fn();
    window.prompt = promptMock;

    act(() => {
      root.render(
        createElement(AssistantSlideOver, {
          onOpenFullView: vi.fn(),
        }),
      );
    });

    // Radix Dialog portals into document.body.
    expect(document.body.textContent).toContain("Renamed session helper");
    expect(document.body.textContent).not.toContain("Web search off");

    // Model badge moved into the settings gear popover (not in the header).
    const headerModelVisible = Array.from(
      document.querySelectorAll('[role="dialog"]'),
    ).some((dialog) =>
      (dialog.textContent ?? "").includes("openrouter / google/gemini-2.5-pro"),
    );
    expect(headerModelVisible).toBe(false);

    const settingsButton = document.querySelector(
      'button[title="Assistant settings"]',
    ) as HTMLButtonElement | null;
    expect(settingsButton).not.toBeNull();

    await act(async () => {
      settingsButton?.click();
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain(
      "openrouter / google/gemini-2.5-pro",
    );

    const renameButton = document.querySelector(
      'button[title="Rename conversation"]',
    ) as HTMLButtonElement | null;
    expect(renameButton).not.toBeNull();

    await act(async () => {
      renameButton?.click();
      await Promise.resolve();
    });

    expect(promptMock).not.toHaveBeenCalled();

    const input = document.querySelector(
      'input[placeholder="Conversation title"]',
    ) as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input?.value).toBe("Renamed session helper");

    const saveButton = Array.from(document.querySelectorAll("button")).find(
      (btn) => btn.textContent === "Save",
    ) as HTMLButtonElement | undefined;
    expect(saveButton).toBeTruthy();

    await act(async () => {
      saveButton?.click();
      await Promise.resolve();
    });

    expect(renameMock).toHaveBeenCalledWith(
      "conversation-1",
      "Renamed session helper",
    );
    expect(refetchMock).toHaveBeenCalledOnce();
  });
});
