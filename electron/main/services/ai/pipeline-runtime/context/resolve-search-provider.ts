import type { SessionRepo } from "../../../../db/repositories/sessions/session-repo";
import type { WorkspacePreferencesRepo } from "../../../../db/repositories/workspace/workspace-prefs-repo";

export function resolveSearchProviderId(
  sessionRepo: SessionRepo,
  workspacePrefsRepo: WorkspacePreferencesRepo,
  sessionId: string,
): string | null {
  const session = sessionRepo.requireById(sessionId);
  const prefs = workspacePrefsRepo.get();
  return session.defaultSearchProviderId ?? prefs.defaultSearchProviderId;
}
