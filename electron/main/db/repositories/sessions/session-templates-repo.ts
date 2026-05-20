import type { DbClient } from "../../client";
import type { SessionTemplate, SessionTemplatePayload } from "@/lib/types";
import { asc, eq } from "drizzle-orm";
import { sessionTemplates } from "../../schema";
import { toSessionTemplate } from "../system/mappers";

export class SessionTemplatesRepo {
  constructor(private readonly client: DbClient) {}

  list(): SessionTemplate[] {
    const rows = this.client.db
      .select()
      .from(sessionTemplates)
      .orderBy(asc(sessionTemplates.name))
      .all();
    return rows.map(toSessionTemplate);
  }

  create(input: {
    name: string;
    description?: string;
    sourceSessionId?: string | null;
    payload: SessionTemplatePayload;
  }): { id: string; updatedAt: string } {
    const id = crypto.randomUUID();
    const updatedAt = new Date().toISOString();
    this.client.db
      .insert(sessionTemplates)
      .values({
        id,
        name: input.name,
        description: input.description ?? null,
        sourceSessionId: input.sourceSessionId ?? null,
        templatePayloadJson: JSON.stringify(input.payload),
        instrumentClasses: JSON.stringify(
          input.payload.identity.instrumentClasses,
        ),
        updatedAt,
      })
      .run();
    return { id, updatedAt };
  }

  delete(id: string): boolean {
    const result = this.client.db
      .delete(sessionTemplates)
      .where(eq(sessionTemplates.id, id))
      .run();
    return result.changes > 0;
  }

  get(id: string): SessionTemplate | null {
    const row = this.client.db
      .select()
      .from(sessionTemplates)
      .where(eq(sessionTemplates.id, id))
      .get();
    return row ? toSessionTemplate(row) : null;
  }
}
