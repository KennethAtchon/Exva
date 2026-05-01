import type { DbClient } from "../client";
import type { ProviderAccount } from "@/lib/types";
import { toProviderAccount } from "./mappers";

export class ProviderAccountsRepo {
  constructor(private readonly client: DbClient) {}

  list(): ProviderAccount[] {
    const rows = this.client.sqlite.prepare("SELECT * FROM provider_accounts ORDER BY name ASC").all() as Record<string, unknown>[];
    return rows.map(toProviderAccount);
  }

  find(id: string): ProviderAccount | null {
    const row = this.client.sqlite.prepare("SELECT * FROM provider_accounts WHERE id = ?").get(id) as Record<string, unknown> | undefined;
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
    this.client.sqlite
      .prepare(
        `
        INSERT INTO provider_accounts (
          id, name, category, provider_type, secret_ref, metadata_json, is_configured, last_test_status, updated_at
        ) VALUES (
          @id, @name, @category, @provider_type, @secret_ref, @metadata_json, @is_configured, 'unknown', @updated_at
        )
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          category = excluded.category,
          provider_type = excluded.provider_type,
          secret_ref = excluded.secret_ref,
          metadata_json = excluded.metadata_json,
          is_configured = excluded.is_configured,
          updated_at = excluded.updated_at
        `,
      )
      .run({
        id: input.id,
        name: input.name,
        category: input.category,
        provider_type: input.providerType,
        secret_ref: input.secretRef,
        metadata_json: input.metadataJson,
        is_configured: input.isConfigured ? 1 : 0,
        updated_at: new Date().toISOString(),
      });
  }

  setLastTestStatus(id: string, status: ProviderAccount["lastTestStatus"]): void {
    this.client.sqlite
      .prepare("UPDATE provider_accounts SET last_test_status = ?, updated_at = ? WHERE id = ?")
      .run(status, new Date().toISOString(), id);
  }
}
