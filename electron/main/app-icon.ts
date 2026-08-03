import { app, nativeImage } from "electron";
import fs from "node:fs";
import path from "node:path";

/**
 * Resolve the Exva brand icon for the process / window.
 * Packaged macOS uses the .icns from the app bundle; this path still matters
 * for Linux/Windows windows and for the macOS dock during `forge start`.
 */
function firstExisting(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** Opaque master icon for BrowserWindow / Linux / packager-adjacent paths. */
export function resolveAppIconPath(): string | null {
  return firstExisting([
    path.join(process.cwd(), "assets", "icon.png"),
    path.join(app.getAppPath(), "assets", "icon.png"),
    path.join(__dirname, "..", "..", "assets", "icon.png"),
    path.join(process.resourcesPath, "icon.png"),
    path.join(process.resourcesPath, "assets", "icon.png"),
  ]);
}

/**
 * Pre-masked squircle with alpha for `app.dock.setIcon` during `forge start`.
 * Packaged .app icons use .icns and get the system mask; dock.setIcon does not.
 */
export function resolveDockIconPath(): string | null {
  return (
    firstExisting([
      path.join(process.cwd(), "assets", "icon-dock.png"),
      path.join(app.getAppPath(), "assets", "icon-dock.png"),
      path.join(__dirname, "..", "..", "assets", "icon-dock.png"),
      path.join(process.resourcesPath, "icon-dock.png"),
    ]) ?? resolveAppIconPath()
  );
}

export function applyProcessIcon(): void {
  const iconPath = resolveDockIconPath();
  if (!iconPath) return;
  if (process.platform === "darwin" && app.dock) {
    app.dock.setIcon(nativeImage.createFromPath(iconPath));
  }
}
