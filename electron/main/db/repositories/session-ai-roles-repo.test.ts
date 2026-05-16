import { describe, expect, it } from "vitest";
import { createTestDb } from "../test-helpers";
import { SessionRepo } from "./session-repo";
import { SessionAiRolesRepo } from "./session-ai-roles-repo";

describe("SessionAiRolesRepo", () => {
  it("backfills existing blank role configs from the workspace default model without overwriting configured roles", () => {
    const db = createTestDb();
    const sessions = new SessionRepo(db);
    const rolesRepo = new SessionAiRolesRepo(db);

    const session = sessions.create({
      name: "Backfill Test",
      objective: "Validate workspace default model backfill",
      selectionMode: "manual_shortlist",
      instrumentClasses: ["stock"],
      instrumentScope: "AAPL",
      capitalLimitUsd: 1000,
      executionMode: "paper_only",
    });

    const before = rolesRepo.listBySession(session.id);
    expect(before.every((role) => role.providerKey === "" && role.modelId === "")).toBe(true);

    rolesRepo.replaceAll(session.id, [
      ...before.filter((role) => role.role !== "reviewer"),
      { ...before.find((role) => role.role === "reviewer")!, providerKey: "provider-custom", modelId: "custom-model" },
    ]);

    const updated = rolesRepo.backfillMissingProviderModel({
      providerKey: "provider-openrouter",
      modelId: "google/gemma-4-31b-it",
    });

    expect(updated).toBe(4);

    const after = rolesRepo.listBySession(session.id);
    expect(after.filter((role) => role.role !== "reviewer").every(
      (role) => role.providerKey === "provider-openrouter" && role.modelId === "google/gemma-4-31b-it",
    )).toBe(true);
    expect(after.find((role) => role.role === "reviewer")).toMatchObject({
      providerKey: "provider-custom",
      modelId: "custom-model",
    });

    db.sqlite.close();
  });
});
