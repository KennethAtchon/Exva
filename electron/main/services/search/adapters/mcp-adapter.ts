import { AppError } from "@electron/shared/infra/errors";
import { parseProviderMetadata } from "@electron/shared/instruments/search-providers";
import type { ProviderAccount } from "@/lib/types";
import type { SearchAdapter, SearchToolResult } from "../search-types";

function clampSnippet(text: string, max = 2000): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

interface McpJsonRpcResponse {
  result?: {
    content?: Array<{ type?: string; text?: string }>;
    structuredContent?: unknown;
    isError?: boolean;
  };
  error?: { message?: string };
}

function adaptMcpPayload(payload: unknown, query: string): SearchToolResult {
  const results: SearchToolResult["results"] = [];
  const pushResult = (title: string, snippet: string, url: string) => {
    if (!snippet && !url) return;
    results.push({
      url: url || "",
      title: title || url || "result",
      snippet: clampSnippet(snippet),
      publishedDate: null,
    });
  };

  if (typeof payload === "string") {
    pushResult("MCP result", payload, "");
  } else if (Array.isArray(payload)) {
    for (const item of payload) {
      if (typeof item !== "object" || item === null) continue;
      const row = item as {
        title?: unknown;
        url?: unknown;
        snippet?: unknown;
        description?: unknown;
      };
      const title = typeof row.title === "string" ? row.title : "";
      const url = typeof row.url === "string" ? row.url : "";
      const snippet =
        typeof row.snippet === "string"
          ? row.snippet
          : typeof row.description === "string"
            ? row.description
            : JSON.stringify(item);
      pushResult(title, snippet, url);
    }
  } else if (typeof payload === "object" && payload !== null) {
    const row = payload as {
      results?: unknown;
      title?: unknown;
      url?: unknown;
      snippet?: unknown;
    };
    if (Array.isArray(row.results)) {
      return adaptMcpPayload(row.results, query);
    }
    const title = typeof row.title === "string" ? row.title : "MCP result";
    const url = typeof row.url === "string" ? row.url : "";
    const snippet =
      typeof row.snippet === "string" ? row.snippet : JSON.stringify(payload);
    pushResult(title, snippet, url);
  } else {
    pushResult("MCP result", String(payload ?? ""), "");
  }

  return {
    results,
    query,
    provider: "mcp",
    creditsUsed: 0,
    cachedAt: new Date().toISOString(),
  };
}

export class McpSearchAdapter implements SearchAdapter {
  readonly providerType = "mcp" as const;

  constructor(
    private readonly account: ProviderAccount,
    private readonly apiKey: string,
  ) {}

  async search(query: string): Promise<SearchToolResult> {
    const metadata = parseProviderMetadata(this.account.metadataJson);
    const serverUrl = metadata.baseUrl?.trim();
    if (!serverUrl) {
      throw new AppError(
        "MCP search provider requires metadata.baseUrl",
        "VALIDATION_FAILED",
      );
    }

    const toolName = metadata.mcpToolName?.trim() || "search";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (this.apiKey.trim()) {
      headers.Authorization = `Bearer ${this.apiKey.trim()}`;
    }

    const response = await fetch(serverUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: {
          name: toolName,
          arguments: { query },
        },
      }),
    });

    if (!response.ok) {
      throw new AppError(
        `MCP search failed with ${response.status}`,
        "PROVIDER_UNREACHABLE",
      );
    }

    const body = (await response.json()) as McpJsonRpcResponse;
    if (body.error?.message) {
      throw new AppError(
        `MCP search error: ${body.error.message}`,
        "PROVIDER_UNREACHABLE",
      );
    }

    const content = body.result?.content ?? [];
    const textParts = content
      .filter(
        (entry) => entry.type === "text" && typeof entry.text === "string",
      )
      .map((entry) => entry.text as string);
    const structured =
      body.result?.structuredContent ??
      (textParts.length > 0 ? textParts.join("\n") : null);

    if (structured == null) {
      throw new AppError(
        "MCP search returned no structured content",
        "PROVIDER_UNREACHABLE",
      );
    }

    let payload: unknown = structured;
    if (typeof structured === "string") {
      try {
        payload = JSON.parse(structured);
      } catch {
        payload = structured;
      }
    }

    return adaptMcpPayload(payload, query);
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.search("test connection");
      return { ok: true };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "MCP search connection failed";
      return { ok: false, error: message };
    }
  }
}
