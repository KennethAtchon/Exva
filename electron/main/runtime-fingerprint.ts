import { execFileSync } from "node:child_process";

export type RuntimeFingerprint = {
  commitSha: string | null;
  dirty: boolean | null;
  source: "env" | "git" | "unavailable";
};

/**
 * Resolve the exact bytes this process believes it is running.
 * Prefer build-injected env; fall back to git in development checkouts.
 */
export function resolveRuntimeFingerprint(
  cwd = process.cwd(),
): RuntimeFingerprint {
  const envCommit = process.env.EXVA_GIT_COMMIT?.trim();
  if (envCommit) {
    return {
      commitSha: envCommit,
      dirty: parseEnvDirtyFlag(process.env.EXVA_GIT_DIRTY),
      source: "env",
    };
  }

  try {
    const commitSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const porcelain = execFileSync("git", ["status", "--porcelain"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return {
      commitSha: commitSha || null,
      dirty: porcelain.length > 0,
      source: "git",
    };
  } catch {
    return { commitSha: null, dirty: null, source: "unavailable" };
  }
}

function parseEnvDirtyFlag(raw: string | undefined): boolean | null {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === "1" || normalized === "true") return true;
  if (normalized === "0" || normalized === "false") return false;
  return null;
}
