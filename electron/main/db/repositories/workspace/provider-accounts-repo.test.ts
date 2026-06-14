import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test-helpers";
import { ProviderAccountsRepo } from "./provider-accounts-repo";

describe("ProviderAccountsRepo", () => {
  it("upserts, finds, updates test status, and deletes provider accounts", () => {
    const db = createTestDb();
    const repo = new ProviderAccountsRepo(db);

    repo.upsert({
      id: "provider-openai",
      name: "OpenAI",
      category: "ai",
      providerType: "openai",
      secretRef: "secret:openai",
      metadataJson: null,
      isConfigured: true,
    });

    expect(repo.find("provider-openai")).toMatchObject({
      name: "OpenAI",
      isConfigured: true,
    });
    expect(repo.list().some((row) => row.id === "provider-openai")).toBe(true);

    repo.setLastTestStatus("provider-openai", "ok");
    expect(repo.find("provider-openai")?.lastTestStatus).toBe("ok");

    repo.upsert({
      id: "provider-openai",
      name: "OpenAI Updated",
      category: "ai",
      providerType: "openai",
      secretRef: "secret:openai",
      metadataJson: '{"model":"gpt-4o"}',
      isConfigured: true,
    });
    expect(repo.find("provider-openai")?.name).toBe("OpenAI Updated");

    repo.delete("provider-openai");
    expect(repo.find("provider-openai")).toBeNull();

    db.sqlite.close();
  });
});
