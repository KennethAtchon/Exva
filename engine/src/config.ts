import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const VERSION = "2.0.0";
export const DEFAULT_PORT = Number(process.env.EXVA_PORT ?? 7420);

export function exvaHome(): string {
  const home = process.env.EXVA_HOME ?? join(homedir(), ".exva");
  mkdirSync(home, { recursive: true });
  return home;
}

export function paths(home = exvaHome()) {
  return {
    home,
    db: join(home, "exva.db"),
    demoDb: join(home, "demo.db"),
    secrets: join(home, "secrets.json"),
    engineFile: join(home, "engine.json"),
  };
}

/** Secrets live outside the repo and the database, in a 0600 file. Paper keys only in v2.0. */
export interface Secrets {
  accounts: Record<string, { keyId: string; secretKey: string }>;
  aiApiKey: string | null;
}

export class SecretsFile {
  constructor(private readonly file: string) {}

  read(): Secrets {
    if (!existsSync(this.file)) return { accounts: {}, aiApiKey: null };
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as Partial<Secrets>;
      return { accounts: parsed.accounts ?? {}, aiApiKey: parsed.aiApiKey ?? null };
    } catch {
      return { accounts: {}, aiApiKey: null };
    }
  }

  update(fn: (s: Secrets) => void): void {
    const s = this.read();
    fn(s);
    writeFileSync(this.file, JSON.stringify(s, null, 2), { mode: 0o600 });
    chmodSync(this.file, 0o600);
  }
}

/** Written by a running engine so the desktop shell and CLI can find it. */
export interface EngineFile {
  pid: number;
  port: number;
  token: string;
  mode: "live" | "demo";
  startedAt: number;
}

export function readEngineFile(file: string): EngineFile | null {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as EngineFile;
  } catch {
    return null;
  }
}
