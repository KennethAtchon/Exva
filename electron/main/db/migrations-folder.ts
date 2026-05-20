import fs from "node:fs";
import path from "node:path";

/** Resolves the Drizzle SQL migrations folder for dev, test, and packaged Electron builds. */
export function resolveMigrationsFolder(): string {
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, "drizzle") : null,
    path.join(process.cwd(), "electron/main/db/drizzle"),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "meta", "_journal.json"))) {
      return candidate;
    }
  }

  throw new Error(
    `Drizzle migrations folder not found (checked: ${candidates.join(", ")})`,
  );
}
