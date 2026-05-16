import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFetchUrlTool } from "../tools/fetch-url-tool";

type FetchUrlExecutor = {
  execute: (input: { url: string; reason?: string }) => Promise<{ content?: string; error?: string }>;
};

describe("fetch-url-tool", () => {
  const fetchMock = vi.fn();
  const apiCallLogRepo = {
    dailyDataSpendUsd: vi.fn(() => 0),
    insert: vi.fn(),
  };

  beforeEach(() => {
    fetchMock.mockReset();
    apiCallLogRepo.dailyDataSpendUsd.mockClear();
    apiCallLogRepo.insert.mockClear();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("blocks internal URLs", async () => {
    const tool = createFetchUrlTool({ sessionId: "s1", apiCallLogRepo: apiCallLogRepo as never }) as unknown as FetchUrlExecutor;
    const result = await tool.execute({ url: "http://localhost:3000/secret" });

    expect(result.error).toContain("blocked");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("strips html and scripts from fetched pages", async () => {
    fetchMock.mockResolvedValue(
      new Response("<html><body><script>alert('x')</script><div>Breakout above 52-week high</div></body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );

    const tool = createFetchUrlTool({ sessionId: "s1", apiCallLogRepo: apiCallLogRepo as never }) as unknown as FetchUrlExecutor;
    const result = await tool.execute({ url: "https://example.com/setup" });

    expect(result.content).toContain("Breakout above 52-week high");
    expect(result.content).not.toContain("<div");
    expect(result.content).not.toContain("alert('x')");
  });

  it("caps fetched content at 8000 chars", async () => {
    fetchMock.mockResolvedValue(
      new Response(`<html><body><div>${"A".repeat(12000)}</div></body></html>`, {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );

    const tool = createFetchUrlTool({ sessionId: "s1", apiCallLogRepo: apiCallLogRepo as never }) as unknown as FetchUrlExecutor;
    const result = await tool.execute({ url: "https://example.com/long" });

    expect(result.content?.length).toBeLessThanOrEqual(8000);
  });

  it("blocks redirects that target internal addresses", async () => {
    // First fetch returns a redirect to a private host.
    fetchMock.mockImplementationOnce(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1:8080/admin" },
        }),
    );

    const tool = createFetchUrlTool({ sessionId: "s1", apiCallLogRepo: apiCallLogRepo as never }) as unknown as FetchUrlExecutor;
    const result = await tool.execute({ url: "https://example.com/bouncer" });

    expect(result.error).toContain("Redirect blocked");
    expect(fetchMock).toHaveBeenCalledTimes(1); // never followed the redirect
  });

  it("blocks IPv6 loopback hostnames", async () => {
    const tool = createFetchUrlTool({ sessionId: "s1", apiCallLogRepo: apiCallLogRepo as never }) as unknown as FetchUrlExecutor;
    const result = await tool.execute({ url: "http://[::1]:9000/internal" });

    expect(result.error).toContain("blocked");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
