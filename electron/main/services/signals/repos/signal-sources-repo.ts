import type { DbClient } from "../../../db/client";
import { signalSources } from "../../../db/schema";
import { eq } from "drizzle-orm";
import type {
  SignalSourceRecord,
  SignalSourceType,
} from "@electron/shared/domain";

export class SignalSourcesRepo {
  constructor(private readonly db: DbClient) {}

  list(): SignalSourceRecord[] {
    return this.db.db
      .select()
      .from(signalSources)
      .all()
      .map((row) => ({ ...row, type: row.type as SignalSourceType }));
  }

  get(id: string): SignalSourceRecord | null {
    const row =
      this.db.db
        .select()
        .from(signalSources)
        .where(eq(signalSources.id, id))
        .get() ?? null;
    return row ? { ...row, type: row.type as SignalSourceType } : null;
  }

  create(
    input: Omit<SignalSourceRecord, "createdAt" | "updatedAt">,
  ): SignalSourceRecord {
    const now = new Date().toISOString();
    this.db.db
      .insert(signalSources)
      .values({
        ...input,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const created = this.get(input.id);
    if (!created) throw new Error(`Signal source ${input.id} was not created.`);
    return created;
  }

  update(
    id: string,
    patch: Partial<{
      type: SignalSourceType;
      name: string;
      description: string | null;
      enabled: boolean;
      configJson: string;
    }>,
  ): SignalSourceRecord {
    this.db.db
      .update(signalSources)
      .set({ ...patch, updatedAt: new Date().toISOString() })
      .where(eq(signalSources.id, id))
      .run();
    const updated = this.get(id);
    if (!updated)
      throw new Error(`Signal source ${id} was not found after update.`);
    return updated;
  }

  delete(id: string): void {
    this.db.db.delete(signalSources).where(eq(signalSources.id, id)).run();
  }

  setEnabled(id: string, enabled: boolean): void {
    this.update(id, { enabled });
  }
}
