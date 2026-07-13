/**
 * UI screenshot harness for the Terminal Ledger overhaul.
 * Usage: bun run scripts/ui-snap.ts [--hub=dashboard] [--theme=dark|light|both] [--out=tmp/ui-snaps]
 */
import path from "node:path";
import { promises as fs } from "node:fs";
import {
  cleanupLaunchedExva,
  launchExva,
  navigateToNavItem,
  waitForAppReady,
} from "../e2e/helpers/launch-app";
import { NAV_ITEMS } from "../src/lib/nav";

const args = process.argv.slice(2);
function arg(name: string, fallback: string): string {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const hubFilter = arg("hub", "all");
const themeArg = arg("theme", "both") as "dark" | "light" | "both";
const outDir = path.resolve(arg("out", "tmp/ui-snaps"));

const hubs =
  hubFilter === "all"
    ? NAV_ITEMS
    : NAV_ITEMS.filter((h) => h.id === hubFilter || h.label === hubFilter);

async function setTheme(
  window: Awaited<ReturnType<typeof launchExva>>["window"],
  theme: "dark" | "light",
) {
  await window.evaluate((next) => {
    localStorage.setItem("exva-theme", next);
    if (next === "light") document.documentElement.classList.add("light");
    else document.documentElement.classList.remove("light");
  }, theme);
  await window.waitForTimeout(200);
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const launched = await launchExva();
  try {
    const { window } = launched;
    await waitForAppReady(window);

    const themes: Array<"dark" | "light"> =
      themeArg === "both" ? ["dark", "light"] : [themeArg];

    for (const theme of themes) {
      await setTheme(window, theme);
      for (const hub of hubs) {
        await navigateToNavItem(window, hub.label);
        await window.waitForTimeout(400);
        const file = path.join(outDir, `${hub.id}-${theme}.png`);
        await window.screenshot({ path: file, fullPage: false });
        // eslint-disable-next-line no-console
        console.log(`wrote ${file}`);
      }
    }

    // Type specimen / token swatch page overlay
    await setTheme(window, "dark");
    await window.evaluate(() => {
      const root = document.createElement("div");
      root.id = "ui-snap-specimen";
      root.style.cssText =
        "position:fixed;inset:0;z-index:99999;background:var(--bg);color:var(--text1);padding:32px;overflow:auto;font-family:var(--font-sans)";
      root.innerHTML = `
        <div style="font-size:19px;font-weight:600;margin-bottom:8px">Terminal Ledger — type & tokens</div>
        <div style="font-family:var(--font-mono);font-size:10.5px;letter-spacing:0.08em;text-transform:uppercase;color:var(--text3);margin-bottom:24px">Instrument Sans · IBM Plex Mono</div>
        <div style="display:grid;gap:12px;margin-bottom:32px">
          <div style="font-size:40px;line-height:44px;font-weight:600;font-family:var(--font-mono);letter-spacing:-0.02em">+$1,284.02</div>
          <div style="font-size:26px;line-height:30px;font-weight:600;font-family:var(--font-mono)">$3.12 spend</div>
          <div style="font-size:19px;font-weight:600">Hub title · text-title</div>
          <div style="font-size:15px;font-weight:600">Section · text-head</div>
          <div style="font-size:13px">Body copy · text-body — the pipeline runs while a session is active.</div>
          <div style="font-family:var(--font-mono);font-size:13px">NVDA · 142.50 · text-data</div>
          <div style="font-family:var(--font-mono);font-size:10.5px;letter-spacing:0.08em;text-transform:uppercase;color:var(--text3)">14:02:11 · selector picked nvda · text-micro</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${[
            "bg",
            "surface",
            "surface2",
            "surface3",
            "border",
            "text1",
            "text2",
            "text3",
            "success",
            "error",
            "warning",
            "info",
            "market",
            "orange",
          ]
            .map((name) => {
              const bg =
                name === "success" ||
                name === "error" ||
                name === "warning" ||
                name === "info" ||
                name === "market" ||
                name === "orange"
                  ? `var(--color-${name})`
                  : name.startsWith("text")
                    ? `var(--${name})`
                    : `var(--${name})`;
              return `<div style="width:72px"><div style="height:40px;border-radius:4px;background:${bg};border:1px solid var(--border)"></div><div style="font-family:var(--font-mono);font-size:10.5px;margin-top:4px;color:var(--text3)">${name}</div></div>`;
            })
            .join("")}
        </div>
      `;
      document.body.appendChild(root);
    });
    await window.screenshot({
      path: path.join(outDir, "type-specimen-dark.png"),
      fullPage: false,
    });
    // eslint-disable-next-line no-console
    console.log(`wrote ${path.join(outDir, "type-specimen-dark.png")}`);
  } finally {
    await cleanupLaunchedExva(launched);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
