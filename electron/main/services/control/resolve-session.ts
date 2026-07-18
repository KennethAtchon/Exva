import type { AppServices } from "../app-services";

export function resolveSession(services: AppServices, ref: string) {
  const sessions = services.repos.session.list({ includeArchived: true });
  const byId = sessions.find((s) => s.id === ref);
  if (byId) return byId;
  const lower = ref.trim().toLowerCase();
  const byName = sessions.find((s) => s.name.toLowerCase() === lower);
  if (byName) return byName;
  const partial = sessions.filter((s) => s.name.toLowerCase().includes(lower));
  if (partial.length === 1) return partial[0];
  throw new Error(
    partial.length > 1
      ? `Ambiguous session "${ref}" — matches ${partial.map((s) => s.name).join(", ")}.`
      : `No session matching "${ref}".`,
  );
}
