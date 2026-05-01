import type { DbClient } from "../client";
import type { SessionTemplate, SessionTemplatePayload } from "@/lib/types";
import { toSessionTemplate } from "./mappers";

export class SessionTemplatesRepo {
  constructor(private readonly client: DbClient) {}

  list(): SessionTemplate[] {
    const rows = this.client.sqlite.prepare("SELECT * FROM session_templates ORDER BY name ASC").all() as Record<string, unknown>[];
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
    this.client.sqlite
      .prepare(
        `
        INSERT INTO session_templates (
          id, name, description, source_session_id, template_payload_json, instrument_classes, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        id,
        input.name,
        input.description ?? null,
        input.sourceSessionId ?? null,
        JSON.stringify(input.payload),
        JSON.stringify(input.payload.identity.instrumentClasses),
        updatedAt,
      );
    return { id, updatedAt };
  }

  delete(id: string): boolean {
    const result = this.client.sqlite.prepare("DELETE FROM session_templates WHERE id = ?").run(id);
    return result.changes > 0;
  }

  get(id: string): SessionTemplate | null {
    const row = this.client.sqlite.prepare("SELECT * FROM session_templates WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? toSessionTemplate(row) : null;
  }
}
