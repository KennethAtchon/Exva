import type { DbClient } from "../client";
import type { BrokerAccount } from "@/lib/types";
import { toBrokerAccount } from "./mappers";

export class BrokerAccountsRepo {
  constructor(private readonly client: DbClient) {}

  list(): BrokerAccount[] {
    const rows = this.client.sqlite.prepare("SELECT * FROM broker_accounts ORDER BY name ASC").all() as Record<string, unknown>[];
    return rows.map(toBrokerAccount);
  }

  find(id: string): BrokerAccount | null {
    const row = this.client.sqlite.prepare("SELECT * FROM broker_accounts WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? toBrokerAccount(row) : null;
  }
}
