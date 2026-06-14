import { describe, expect, it, vi } from "vitest";
import { resolveSearchProviderId } from "../resolve-search-provider";

describe("resolveSearchProviderId", () => {
  it("prefers the session default search provider", () => {
    const sessionRepo = {
      requireById: vi.fn().mockReturnValue({
        defaultSearchProviderId: "session-provider",
      }),
    };
    const workspacePrefsRepo = {
      get: vi.fn().mockReturnValue({
        defaultSearchProviderId: "workspace-provider",
      }),
    };

    expect(
      resolveSearchProviderId(
        sessionRepo as never,
        workspacePrefsRepo as never,
        "s1",
      ),
    ).toBe("session-provider");
  });

  it("falls back to workspace preferences when session has no override", () => {
    const sessionRepo = {
      requireById: vi.fn().mockReturnValue({
        defaultSearchProviderId: null,
      }),
    };
    const workspacePrefsRepo = {
      get: vi.fn().mockReturnValue({
        defaultSearchProviderId: "workspace-provider",
      }),
    };

    expect(
      resolveSearchProviderId(
        sessionRepo as never,
        workspacePrefsRepo as never,
        "s1",
      ),
    ).toBe("workspace-provider");
  });
});
