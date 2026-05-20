import { describe, expect, it, vi } from "vitest";
import { TradeAutopsyService } from "../trade-autopsy-service";

describe("trade-autopsy-service", () => {
  it("uses latest message provider/model when generating summary", async () => {
    const insert = vi.fn();
    const agentMessages = [
      {
        role: "review",
        provider_key: "provider-openai",
        model_id: "gpt-4o-mini",
        output_json: "{\"x\":1}",
        messages_json: "[]",
      },
    ];
    const service = new TradeAutopsyService(
      { require: () => ({ id: "t1", sessionId: "s1", final_pnl_usd: 12.34 }) } as never,
      { listByTrade: () => agentMessages } as never,
      { insert, listByTrade: () => [] } as never,
      {
        get: async () => ({
          generateText: async () => ({ text: "autopsy ok" }),
        }),
      } as never,
    );

    const out = await service.summarize("t1");
    expect(out.model_id).toBe("gpt-4o-mini");
    expect(out.summary).toBe("autopsy ok");
    expect(insert).toHaveBeenCalledOnce();
  });

  it("falls back to local summary when provider fails", async () => {
    const agentMessages = [
      {
        role: "technical",
        provider_key: "provider-anthropic",
        model_id: "claude-sonnet-4-6",
        output_json: null,
        messages_json: "[{\"role\":\"assistant\",\"content\":\"x\"}]",
      },
    ];
    const service = new TradeAutopsyService(
      { require: () => ({ id: "t1", sessionId: "s1", final_pnl_usd: -2.5 }) } as never,
      { listByTrade: () => agentMessages } as never,
      { insert: vi.fn(), listByTrade: () => [] } as never,
      {
        get: async () => {
          throw new Error("provider down");
        },
      } as never,
    );

    const out = await service.summarize("t1");
    expect(out.summary).toContain("Autopsy fallback summary");
  });
});
