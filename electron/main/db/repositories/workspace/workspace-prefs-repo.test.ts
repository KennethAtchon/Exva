import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test-helpers";
import { ProviderAccountsRepo } from "./provider-accounts-repo";
import { WorkspacePreferencesRepo } from "./workspace-prefs-repo";

describe("WorkspacePreferencesRepo", () => {
  it("reads and updates workspace preferences through Drizzle", () => {
    const db = createTestDb();
    const repo = new WorkspacePreferencesRepo(db);
    new ProviderAccountsRepo(db).upsert({
      id: "provider-123",
      name: "Test Search",
      category: "search",
      providerType: "openai",
      secretRef: "secret:test-search",
      metadataJson: null,
      isConfigured: true,
    });

    expect(repo.get()).toMatchObject({
      id: 1,
      globalIncludeArchived: false,
      defaultSearchProviderId: "builtin-search-duckduckgo",
      allocationEnforcementOverride: null,
      autoApproveAssistantTools: false,
    });

    const updated = repo.update({
      globalIncludeArchived: true,
      defaultSearchProviderId: "provider-123",
      allocationEnforcementOverride: "warn",
      autoApproveAssistantTools: true,
    });

    expect(updated).toMatchObject({
      id: 1,
      globalIncludeArchived: true,
      defaultSearchProviderId: "provider-123",
      allocationEnforcementOverride: "warn",
      autoApproveAssistantTools: true,
    });
    expect(repo.get()).toMatchObject(updated);

    db.sqlite.close();
  });
});
