import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SAMPLE_HTML = `
<div class="result">
  <div class="result__body">
    <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Farticle">NVDA &amp; earnings</a>
    <a class="result__snippet">Revenue beat expectations.</a>
  </div>
</div>
<div class="result">
  <div class="result__body">
    <a class="result__a" href="https://news.example.com/story">Second headline</a>
    <a class="result__snippet">Follow-up detail.</a>
  </div>
</div>
`;

describe("DuckDuckGoAdapter", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes DuckDuckGo HTML search results", async () => {
    fetchMock.mockResolvedValue(
      new Response(SAMPLE_HTML, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );
    const { DuckDuckGoAdapter } = await import("../duckduckgo-adapter");
    const adapter = new DuckDuckGoAdapter();

    const result = await adapter.search("nvda earnings");

    expect(result.provider).toBe("duckduckgo");
    expect(result.creditsUsed).toBe(0);
    expect(result.results).toEqual([
      {
        url: "https://example.com/article",
        title: "NVDA & earnings",
        snippet: "Revenue beat expectations.",
        publishedDate: null,
      },
      {
        url: "https://news.example.com/story",
        title: "Second headline",
        snippet: "Follow-up detail.",
        publishedDate: null,
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://html.duckduckgo.com/html/?q=nvda%20earnings",
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "text/html,application/xhtml+xml",
        }),
      }),
    );
  });

  it("throws PROVIDER_UNREACHABLE when DuckDuckGo returns no parseable results", async () => {
    fetchMock.mockResolvedValue(
      new Response("<html><body>no results here</body></html>", {
        status: 200,
      }),
    );
    const { DuckDuckGoAdapter } = await import("../duckduckgo-adapter");
    const adapter = new DuckDuckGoAdapter();

    await expect(adapter.search("empty")).rejects.toMatchObject({
      code: "PROVIDER_UNREACHABLE",
      message: "DuckDuckGo search returned no parseable results.",
    });
  });

  it("throws PROVIDER_UNREACHABLE when DuckDuckGo returns a non-ok response", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 503 }));
    const { DuckDuckGoAdapter } = await import("../duckduckgo-adapter");
    const adapter = new DuckDuckGoAdapter();

    await expect(adapter.search("broken")).rejects.toMatchObject({
      code: "PROVIDER_UNREACHABLE",
      message: "DuckDuckGo search failed with 503",
    });
  });

  it("reports testConnection success when search succeeds", async () => {
    fetchMock.mockResolvedValue(
      new Response(SAMPLE_HTML, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );
    const { DuckDuckGoAdapter } = await import("../duckduckgo-adapter");
    const adapter = new DuckDuckGoAdapter();

    await expect(adapter.testConnection()).resolves.toEqual({ ok: true });
  });
});
