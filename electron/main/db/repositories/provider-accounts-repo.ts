import type { DbClient } from "../client";
import type { ProviderAccount } from "@/lib/types";
import { asc, eq } from "drizzle-orm";
import { providerAccounts } from "../schema";
import { toProviderAccount } from "./mappers";

export class ProviderAccountsRepo {
  constructor(private readonly client: DbClient) {}

  list(): ProviderAccount[] {
    const rows = this.client.db.select().from(providerAccounts).orderBy(asc(providerAccounts.name)).all();
    return rows.map(toProviderAccount);
  }

  find(id: string): ProviderAccount | null {
    const row = this.client.db.select().from(providerAccounts).where(eq(providerAccounts.id, id)).get();
    return row ? toProviderAccount(row) : null;
  }

  upsert(input: {
    id: string;
    name: string;
    category: "ai" | "search";
    providerType: ProviderAccount["providerType"];
    secretRef: string;
    metadataJson: string | null;
    isConfigured: boolean;
  }): void {
    const updatedAt = new Date().toISOString();
    this.client.db
      .insert(providerAccounts)
      .values({
        id: input.id,
        name: input.name,
        category: input.category,
        providerType: input.providerType,
        secretRef: input.secretRef,
        metadataJson: input.metadataJson,
        isConfigured: input.isConfigured,
        lastTestStatus: "unknown",
        updatedAt,
      })
      .onConflictDoUpdate({
        target: providerAccounts.id,
        set: {
          name: input.name,
          category: input.category,
          providerType: input.providerType,
          secretRef: input.secretRef,
          metadataJson: input.metadataJson,
          isConfigured: input.isConfigured,
          updatedAt,
        },
      })
      .run();
  }

  setLastTestStatus(id: string, status: ProviderAccount["lastTestStatus"]): void {
    this.client.db
      .update(providerAccounts)
      .set({ lastTestStatus: status, updatedAt: new Date().toISOString() })
      .where(eq(providerAccounts.id, id))
      .run();
  }

  delete(id: string): void {
    this.client.db.delete(providerAccounts).where(eq(providerAccounts.id, id)).run();
  }
}
