import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import type { AgentRole } from "@/lib/types";
import { env } from "../../config/env";

function resolvePromptsDir(): string {
  if (env.promptsDirOverride) return env.promptsDirOverride;
  if (app?.isPackaged) return path.join(process.resourcesPath, "prompts");
  const appPath = typeof app?.getAppPath === "function" ? app.getAppPath() : null;
  if (appPath) return path.join(appPath, "electron", "prompts");
  return path.join(process.cwd(), "electron", "prompts");
}

export class PromptAssetLoader {
  private readonly assetDir = resolvePromptsDir();

  load(role: AgentRole): string {
    return this.readAssetBody(this.assetPath(role));
  }

  loadNamedAsset(name: string): string {
    return this.readAssetBody(this.namedAssetPath(name));
  }

  version(role: AgentRole): string {
    const raw = fs.readFileSync(this.assetPath(role), "utf8");
    const match = raw.match(/<!--\s*version:\s*([\d.]+)\s*-->/i);
    return match?.[1] ?? "unknown";
  }

  assetPath(role: AgentRole): string {
    return path.join(this.assetDir, `${role}.md`);
  }

  namedAssetPath(name: string): string {
    return path.join(this.assetDir, `${name}.md`);
  }

  private readAssetBody(assetPath: string): string {
    const raw = fs.readFileSync(assetPath, "utf8");
    return raw.replace(/^<!--\s*version:\s*[\d.]+\s*-->\s*/i, "").trim();
  }
}
