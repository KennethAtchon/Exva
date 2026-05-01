import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import type { AgentRole } from "@/lib/types";
import { env } from "../../config/env";

function resolvePromptsDir(): string {
  if (env.promptsDirOverride) return env.promptsDirOverride;
  if (app.isPackaged) return path.join(process.resourcesPath, "prompts");
  return path.join(app.getAppPath(), "electron", "prompts");
}

export class PromptAssetLoader {
  private readonly assetDir = resolvePromptsDir();

  load(role: AgentRole): string {
    return fs.readFileSync(this.assetPath(role), "utf8");
  }

  assetPath(role: AgentRole): string {
    return path.join(this.assetDir, `${role}.md`);
  }
}
