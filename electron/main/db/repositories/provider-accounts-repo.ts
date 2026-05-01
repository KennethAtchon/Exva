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
}
