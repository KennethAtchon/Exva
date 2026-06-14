import { describe, expect, it, vi } from "vitest";
import { InstrumentCacheService } from "../instrument-cache-service";
import type { InstrumentCacheRepo } from "../../../db/repositories/market/instrument-cache-repo";

describe("InstrumentCacheService", () => {
  it("delegates clear to repo", () => {
    const repo = {
      clear: vi.fn(),
      get: vi.fn(),
    } as unknown as InstrumentCacheRepo;
    const service = new InstrumentCacheService(repo, vi.fn() as never);
    service.clear("session-1");
    expect(repo.clear).toHaveBeenCalledWith("session-1");
  });
});
