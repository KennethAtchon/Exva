import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import type { AgentRole } from "@/lib/types";
import { env } from "../../config/env";
import { NAMED_PROMPT_OPERATING_SUPPLEMENT } from "../../../shared/default-ai-role-operating-notes";

function resolvePromptsDir(): string {
  if (env.promptsDirOverride) return env.promptsDirOverride;
  if (app?.isPackaged) return path.join(process.resourcesPath, "prompts");
  const appPath = typeof app?.getAppPath === "function" ? app.getAppPath() : null;
  if (appPath) return path.join(appPath, "electron", "prompts");
  return path.join(process.cwd(), "electron", "prompts");
}

const SHARED_HOWTO_FILE = "_shared-context-howto.md";

export class PromptAssetLoader {
  private readonly assetDir = resolvePromptsDir();

  load(role: AgentRole): string {
    const raw = fs.readFileSync(this.assetPath(role), "utf8");
    const body = raw.replace(/^<!--\s*version:\s*[\d.]+\s*-->\s*/i, "").trim();
    return this.appendSharedHowto(body);
  }

  loadNamedAsset(name: string): string {
    const raw = fs.readFileSync(this.namedAssetPath(name), "utf8");
    let body = raw.replace(/^<!--\s*version:\s*[\d.]+\s*-->\s*/i, "").trim();
    const supplement = NAMED_PROMPT_OPERATING_SUPPLEMENT[name];
    if (supplement?.trim()) {
      body = `${body}\n\n${supplement.trim()}`;
    }
    return this.appendSharedHowto(body);
  }

  private appendSharedHowto(roleBody: string): string {
    const sharedPath = path.join(this.assetDir, SHARED_HOWTO_FILE);
    if (!fs.existsSync(sharedPath)) return roleBody;
    const raw = fs.readFileSync(sharedPath, "utf8");
    const suffix = raw.replace(/^<!--\s*version:\s*[\d.]+\s*-->\s*/i, "").trim();
    return `${roleBody}\n\n${suffix}`;
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
}
