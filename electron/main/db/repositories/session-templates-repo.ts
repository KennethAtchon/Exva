import type { DbClient } from "../client";
import type { SessionTemplate } from "@/lib/types";
import { toSessionTemplate } from "./mappers";

export class SessionTemplatesRepo {
  constructor(private readonly client: DbClient) {}

  list(): SessionTemplate[] {
    const rows = this.client.sqlite.prepare("SELECT * FROM session_templates ORDER BY name ASC").all() as Record<string, unknown>[];
    return rows.map(toSessionTemplate);
  }
}
