import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderAccount } from "@/lib/types";

function buildMcpAccount(
  overrides?: Partial<ProviderAccount>,
): ProviderAccount {
  return {
    id: "provider-mcp-search",
    name: "MCP Search",
    category: "search",
    providerType: "mcp",
    secretRef: "exva:mcp-search",
    metadataJson: JSON.stringify({
      baseUrl: "https://mcp.example/search",
      mcpToolName: "web_search",
    }),
    isConfigured: true,
    lastTestStatus: "unknown",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("McpSearchAdapter", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes structured MCP search payloads", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          result: {
            structuredContent: {
              results: [
                {
                  title: "Macro update",
                  url: "https://example.com/macro",
                  snippet: "Inflation cooled in May.",
                },
              ],
            },
          },
        }),
        { status: 200 },
      ),
    );
    const { McpSearchAdapter } = await import("../mcp-adapter");
    const adapter = new McpSearchAdapter(buildMcpAccount(), "mcp-token");

    const result = await adapter.search("macro update");

    expect(result).toMatchObject({
      query: "macro update",
      provider: "mcp",
      creditsUsed: 0,
      cachedAt: expect.any(String),
      results: [
        {
          title: "Macro update",
          url: "https://example.com/macro",
          snippet: "Inflation cooled in May.",
          publishedDate: null,
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://mcp.example/search",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer mcp-token",
        }),
        body: expect.stringContaining('"method":"tools/call"'),
      }),
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.params).toEqual({
      name: "web_search",
      arguments: { query: "macro update" },
    });
  });

  it("parses JSON text content from MCP responses", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify([
                  {
                    title: "Parsed row",
                    url: "https://example.com/parsed",
                    description: "From text content",
                  },
                ]),
              },
            ],
          },
        }),
        { status: 200 },
      ),
    );
    const { McpSearchAdapter } = await import("../mcp-adapter");
    const adapter = new McpSearchAdapter(buildMcpAccount(), "");

    const result = await adapter.search("parsed");

    expect(result.results).toEqual([
      {
        title: "Parsed row",
        url: "https://example.com/parsed",
        snippet: "From text content",
        publishedDate: null,
      },
    ]);
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init?.headers).not.toHaveProperty("Authorization");
  });

  it("supports MCP providers that authenticate with an API key query parameter", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          result: {
            structuredContent: {
              title: "Exa result",
              snippet: "Authenticated with query params.",
              url: "https://example.com/exa",
            },
          },
        }),
        { status: 200 },
      ),
    );
    const { McpSearchAdapter } = await import("../mcp-adapter");
    const adapter = new McpSearchAdapter(
      buildMcpAccount({
        metadataJson: JSON.stringify({
          baseUrl: "https://mcp.exa.ai/mcp",
          mcpAuthMode: "query",
          mcpApiKeyQueryParam: "exaApiKey",
        }),
      }),
      "exa-token/with space",
    );

    await adapter.search("earnings catalyst");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://mcp.exa.ai/mcp?exaApiKey=exa-token%2Fwith+space",
      expect.objectContaining({
        headers: expect.not.objectContaining({
          Authorization: expect.any(String),
        }),
      }),
    );
  });

  it("requires metadata.baseUrl before calling MCP", async () => {
    const { McpSearchAdapter } = await import("../mcp-adapter");
    const adapter = new McpSearchAdapter(
      buildMcpAccount({ metadataJson: null }),
      "mcp-token",
    );

    await expect(adapter.search("macro")).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      message: "MCP search provider requires metadata.baseUrl",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws PROVIDER_UNREACHABLE for HTTP and JSON-RPC errors", async () => {
    const { McpSearchAdapter } = await import("../mcp-adapter");
    const adapter = new McpSearchAdapter(buildMcpAccount(), "mcp-token");

    fetchMock.mockResolvedValue(new Response("", { status: 502 }));
    await expect(adapter.search("http-error")).rejects.toMatchObject({
      code: "PROVIDER_UNREACHABLE",
      message: "MCP search failed with 502",
    });

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "tool unavailable" } }), {
        status: 200,
      }),
    );
    await expect(adapter.search("rpc-error")).rejects.toMatchObject({
      code: "PROVIDER_UNREACHABLE",
      message: "MCP search error: tool unavailable",
    });
  });

  it("reports testConnection success when search succeeds", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          result: {
            structuredContent: {
              title: "Ping",
              snippet: "ok",
              url: "https://example.com",
            },
          },
        }),
        { status: 200 },
      ),
    );
    const { McpSearchAdapter } = await import("../mcp-adapter");
    const adapter = new McpSearchAdapter(buildMcpAccount(), "mcp-token");

    await expect(adapter.testConnection()).resolves.toEqual({ ok: true });
  });
});
