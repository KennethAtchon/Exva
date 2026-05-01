import type { DbClient } from "../client";
import type { AgentRole, SessionAiRole } from "@/lib/types";
import { AppError } from "@electron/shared/errors";
import { toSessionAiRole } from "./mappers";

export class SessionAiRolesRepo {
  constructor(private readonly client: DbClient) {}

  listBySession(sessionId: string): SessionAiRole[] {
    const rows = this.client.sqlite
      .prepare("SELECT * FROM session_ai_roles WHERE session_id = ? ORDER BY role ASC")
      .all(sessionId) as Record<string, unknown>[];
    return rows.map(toSessionAiRole);
  }

  getByRole(sessionId: string, role: AgentRole): SessionAiRole | null {
    const row = this.client.sqlite
      .prepare("SELECT * FROM session_ai_roles WHERE session_id = ? AND role = ?")
      .get(sessionId, role) as Record<string, unknown> | undefined;
    return row ? toSessionAiRole(row) : null;
  }

  requireByRole(sessionId: string, role: AgentRole): SessionAiRole {
    const aiRole = this.getByRole(sessionId, role);
    if (!aiRole) {
      throw new AppError(`AI role ${role} for session ${sessionId} was not found`, "NOT_FOUND", { sessionId, role });
    }
    return aiRole;
  }

  replaceAll(sessionId: string, aiRoles: SessionAiRole[]): void {
    const stmt = this.client.sqlite.prepare(
      `
      UPDATE session_ai_roles SET
        provider_key = @provider_key,
        model_id = @model_id,
        temperature = @temperature,
        max_tokens = @max_tokens,
        web_search_enabled = @web_search_enabled,
        prompt_source = @prompt_source,
        prompt_markdown = @prompt_markdown,
        prompt_asset_path = @prompt_asset_path
      WHERE session_id = @session_id AND role = @role
      `,
    );

    this.client.sqlite.transaction(() => {
      for (const aiRole of aiRoles) {
        stmt.run({
          session_id: sessionId,
          role: aiRole.role,
          provider_key: aiRole.providerKey,
          model_id: aiRole.modelId,
          temperature: aiRole.temperature,
          max_tokens: aiRole.maxTokens,
          web_search_enabled: aiRole.webSearchEnabled ? 1 : 0,
          prompt_source: aiRole.promptSource,
          prompt_markdown: aiRole.promptMarkdown,
          prompt_asset_path: aiRole.promptAssetPath,
        });
      }
    })();
  }
}
