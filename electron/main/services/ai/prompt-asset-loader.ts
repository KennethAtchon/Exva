import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { env } from "../../config/env";

function resolvePromptsDir(): string {
  if (env.promptsDirOverride) return env.promptsDirOverride;
  if (app?.isPackaged) return path.join(process.resourcesPath, "prompts");
  const appPath =
    typeof app?.getAppPath === "function" ? app.getAppPath() : null;
  if (appPath)
    return path.join(
      appPath,
      "electron",
      "main",
      "services",
      "ai",
      "pipeline-runtime",
      "prompts",
    );
  return path.join(
    process.cwd(),
    "electron",
    "main",
    "services",
    "ai",
    "pipeline-runtime",
    "prompts",
  );
}

export class PromptAssetLoader {
  private readonly assetDir = resolvePromptsDir();

  load(name: string): string {
    return this.readAssetBody(path.join(this.assetDir, `${name}.md`));
  }

  version(name: string): string {
    const raw = fs.readFileSync(path.join(this.assetDir, `${name}.md`), "utf8");
    const match = raw.match(/<!--\s*version:\s*([\d.]+)\s*-->/i);
    return match?.[1] ?? "unknown";
  }

  private readAssetBody(assetPath: string): string {
    const raw = fs.readFileSync(assetPath, "utf8");
    return raw.replace(/^<!--\s*version:\s*[\d.]+\s*-->\s*/i, "").trim();
  }
}
