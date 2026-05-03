import type { DbClient } from "../client";
import type { BrokerAccount, BrokerMode, InstrumentClass } from "@/lib/types";
import { AppError } from "@electron/shared/errors";
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

  require(id: string): BrokerAccount {
    const account = this.find(id);
    if (!account) throw new AppError(`Broker account ${id} was not found`, "NOT_FOUND", { id });
    return account;
  }

  insert(input: {
    id: string;
    name: string;
    brokerType: string;
    supportedInstrumentClasses: InstrumentClass[];
    mode: BrokerMode;
    secretRef: string;
  }): BrokerAccount {
    const now = new Date().toISOString();
    this.client.sqlite
      .prepare(
        `
        INSERT INTO broker_accounts (
          id, name, broker_type, supported_instrument_classes, mode, secret_ref, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        input.id,
        input.name,
        input.brokerType,
        JSON.stringify(input.supportedInstrumentClasses),
        input.mode,
        input.secretRef,
        now,
      );
    return this.require(input.id);
  }

  delete(id: string): void {
    this.client.sqlite.prepare("DELETE FROM broker_accounts WHERE id = ?").run(id);
  }
}
