import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("TavilyAdapter", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes Tavily search results", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              title: "Fed minutes",
              content: "Rates may hold steady through Q3.",
              url: "https://example.com/fed",
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const { TavilyAdapter } = await import("../tavily-adapter");
    const adapter = new TavilyAdapter("tvly-test");

    const result = await adapter.search("fed minutes");

    expect(result).toEqual({
      results: [
        {
          url: "https://example.com/fed",
          title: "Fed minutes",
          snippet: "Rates may hold steady through Q3.",
          publishedDate: null,
        },
      ],
      query: "fed minutes",
      provider: "tavily",
      creditsUsed: 1,
      cachedAt: null,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.tavily.com/search",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          api_key: "tvly-test",
          query: "fed minutes",
          search_depth: "advanced",
          max_results: 7,
          include_answer: false,
          include_raw_content: false,
        }),
      }),
    );
  });

  it("retries on 429 before returning the final response", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [] }), { status: 200 }),
      );
    const { TavilyAdapter } = await import("../tavily-adapter");
    const adapter = new TavilyAdapter("tvly-test");

    const result = await adapter.search("retry query");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.results).toEqual([]);
  });

  it("throws PROVIDER_UNREACHABLE when Tavily returns a non-ok response", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    const { TavilyAdapter } = await import("../tavily-adapter");
    const adapter = new TavilyAdapter("tvly-test");

    await expect(adapter.search("broken")).rejects.toMatchObject({
      code: "PROVIDER_UNREACHABLE",
      message: "Tavily search failed with 500",
    });
  });

  it("reports testConnection success when search succeeds", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              title: "Headline",
              content: "Snippet",
              url: "https://example.com",
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const { TavilyAdapter } = await import("../tavily-adapter");
    const adapter = new TavilyAdapter("tvly-test");

    await expect(adapter.testConnection()).resolves.toEqual({ ok: true });
  });
});
