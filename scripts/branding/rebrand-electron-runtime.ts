/**
 * Rebrand the vendored Electron runtime so forge-start looks like Exva on macOS:
 * - Electron.app → Exva.app
 * - MacOS/Electron → Exva
 * - Info.plist name / id / icon
 * - Helper display names
 * - node_modules/electron/path.txt
 *
 * Idempotent. No-op on non-darwin. Does not touch source imports — those are
 * the framework, not product branding.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_NAME = "Exva";
const BUNDLE_ID = "app.exva.desktop";
const ICON_FILE = "exva.icns";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dist = path.join(root, "node_modules/electron/dist");
const pathTxt = path.join(root, "node_modules/electron/path.txt");
const iconSrc = path.join(root, "assets/icon.icns");

function fail(msg: string): never {
  console.error(`[rebrand-electron-runtime] ${msg}`);
  process.exit(1);
}

function plutilReplace(plist: string, key: string, value: string): void {
  const result = spawnSync(
    "plutil",
    ["-replace", key, "-string", value, plist],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    fail(`plutil -replace ${key} on ${plist}: ${result.stderr || result.stdout}`);
  }
}

function plutilSetOrReplace(plist: string, key: string, value: string): void {
  const has = spawnSync("plutil", ["-extract", key, "raw", plist], {
    encoding: "utf8",
  });
  if (has.status === 0) {
    plutilReplace(plist, key, value);
    return;
  }
  const inserted = spawnSync(
    "plutil",
    ["-insert", key, "-string", value, plist],
    { encoding: "utf8" },
  );
  if (inserted.status !== 0) {
    fail(`plutil -insert ${key} on ${plist}: ${inserted.stderr || inserted.stdout}`);
  }
}

function renameIfExists(from: string, to: string): void {
  if (!fs.existsSync(from)) return;
  if (fs.existsSync(to)) {
    // Already rebranded or collision — prefer destination if source leftover.
    if (path.basename(from).startsWith("Electron")) {
      fs.rmSync(from, { recursive: true, force: true });
    }
    return;
  }
  fs.renameSync(from, to);
}

if (process.platform !== "darwin") {
  process.exit(0);
}

if (!fs.existsSync(dist)) {
  console.warn(`[rebrand-electron-runtime] skip: missing ${dist}`);
  process.exit(0);
}

const electronApp = path.join(dist, "Electron.app");
const exvaApp = path.join(dist, "Exva.app");

if (fs.existsSync(electronApp) && !fs.existsSync(exvaApp)) {
  fs.renameSync(electronApp, exvaApp);
} else if (!fs.existsSync(exvaApp)) {
  fail(`neither Electron.app nor Exva.app found under ${dist}`);
}

const contents = path.join(exvaApp, "Contents");
const macos = path.join(contents, "MacOS");
const resources = path.join(contents, "Resources");
const plist = path.join(contents, "Info.plist");
const electronBin = path.join(macos, "Electron");
const exvaBin = path.join(macos, "Exva");

renameIfExists(electronBin, exvaBin);
if (!fs.existsSync(exvaBin)) {
  fail(`missing executable at ${exvaBin}`);
}

if (!fs.existsSync(iconSrc)) {
  fail(`missing brand icon ${iconSrc} — run icon render first`);
}
fs.copyFileSync(iconSrc, path.join(resources, ICON_FILE));
// Drop stock Electron icon so nothing still points at it by accident.
const stockIcon = path.join(resources, "electron.icns");
if (fs.existsSync(stockIcon)) fs.unlinkSync(stockIcon);

plutilReplace(plist, "CFBundleName", APP_NAME);
plutilSetOrReplace(plist, "CFBundleDisplayName", APP_NAME);
plutilReplace(plist, "CFBundleExecutable", APP_NAME);
plutilReplace(plist, "CFBundleIdentifier", BUNDLE_ID);
plutilReplace(plist, "CFBundleIconFile", ICON_FILE);

// Helper apps: display name only (binaries stay — framework paths depend on them).
const frameworks = path.join(contents, "Frameworks");
if (fs.existsSync(frameworks)) {
  for (const entry of fs.readdirSync(frameworks)) {
    if (!entry.includes("Helper") || !entry.endsWith(".app")) continue;
    const helperPlist = path.join(frameworks, entry, "Contents", "Info.plist");
    if (!fs.existsSync(helperPlist)) continue;
    const label = entry
      .replace(/^Electron /, `${APP_NAME} `)
      .replace(/\.app$/, "");
    plutilSetOrReplace(helperPlist, "CFBundleName", label);
    plutilSetOrReplace(helperPlist, "CFBundleDisplayName", label);
  }
}

const expectedPath = `${APP_NAME}.app/Contents/MacOS/${APP_NAME}`;
fs.writeFileSync(pathTxt, expectedPath, "utf8");

console.log(`[rebrand-electron-runtime] ${expectedPath}`);
console.log(`[rebrand-electron-runtime] bundle id ${BUNDLE_ID}, icon ${ICON_FILE}`);
