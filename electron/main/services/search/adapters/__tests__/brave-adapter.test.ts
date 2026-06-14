import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("BraveAdapter", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes Brave web search results", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          web: {
            results: [
              {
                title: "NVDA earnings beat",
                description: "Revenue up 20%",
                url: "https://example.com/nvda",
                age: "2d",
              },
            ],
          },
        }),
        { status: 200 },
      ),
    );
    const { BraveAdapter } = await import("../brave-adapter");
    const adapter = new BraveAdapter("brave-key");

    const result = await adapter.search("nvda earnings");

    expect(result).toEqual({
      results: [
        {
          url: "https://example.com/nvda",
          title: "NVDA earnings beat",
          snippet: "NVDA earnings beat — Revenue up 20%",
          publishedDate: "2d",
        },
      ],
      query: "nvda earnings",
      provider: "brave",
      creditsUsed: 1,
      cachedAt: null,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.search.brave.com/res/v1/web/search?q=nvda%20earnings",
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Subscription-Token": "brave-key",
        }),
      }),
    );
  });

  it("retries on 429 before surfacing provider errors", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ web: { results: [] } }), {
          status: 200,
        }),
      );
    const { BraveAdapter } = await import("../brave-adapter");
    const adapter = new BraveAdapter("brave-key");

    const result = await adapter.search("retry query");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.results).toEqual([]);
    expect(result.provider).toBe("brave");
  });

  it("throws PROVIDER_UNREACHABLE when Brave returns a non-ok response", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 503 }));
    const { BraveAdapter } = await import("../brave-adapter");
    const adapter = new BraveAdapter("brave-key");

    await expect(adapter.search("broken")).rejects.toMatchObject({
      code: "PROVIDER_UNREACHABLE",
      message: "Brave search failed with 503",
    });
  });

  it("reports testConnection success when search succeeds", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          web: {
            results: [
              {
                title: "Headline",
                description: "Snippet",
                url: "https://example.com",
              },
            ],
          },
        }),
        { status: 200 },
      ),
    );
    const { BraveAdapter } = await import("../brave-adapter");
    const adapter = new BraveAdapter("brave-key");

    await expect(adapter.testConnection()).resolves.toEqual({ ok: true });
  });
});
