#!/usr/bin/env node
/** Replace promptAssetPath with prompt imports from worker-prompts.ts */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(new URL("..", import.meta.url).pathname);

const PROMPT_MAP = {
  "selector-workers/web-scout": "SELECTOR_WORKERS_WEB_SCOUT_PROMPT",
  "selector-workers/reddit-scout": "SELECTOR_WORKERS_REDDIT_SCOUT_PROMPT",
  "selector-workers/trend-scout": "SELECTOR_WORKERS_TREND_SCOUT_PROMPT",
  "selector-workers/event-web-scout": "SELECTOR_WORKERS_EVENT_WEB_SCOUT_PROMPT",
  "selector-workers/event-prediction-scout": "SELECTOR_WORKERS_EVENT_PREDICTION_SCOUT_PROMPT",
  "selector-workers/market-validator": "SELECTOR_WORKERS_MARKET_VALIDATOR_PROMPT",
  "selector-workers/catalyst-extractor": "SELECTOR_WORKERS_CATALYST_EXTRACTOR_PROMPT",
  "selector-workers/liquidity-gate": "SELECTOR_WORKERS_LIQUIDITY_GATE_PROMPT",
  "technical-workers/chart-pattern": "TECHNICAL_WORKERS_CHART_PATTERN_PROMPT",
  "technical-workers/momentum-indicator": "TECHNICAL_WORKERS_MOMENTUM_INDICATOR_PROMPT",
  "technical-workers/volume-profile": "TECHNICAL_WORKERS_VOLUME_PROFILE_PROMPT",
  "technical-workers/event-implied-probability":
    "TECHNICAL_WORKERS_EVENT_IMPLIED_PROBABILITY_PROMPT",
  "technical-workers/event-price-drift": "TECHNICAL_WORKERS_EVENT_PRICE_DRIFT_PROMPT",
  "technical-workers/event-liquidity": "TECHNICAL_WORKERS_EVENT_LIQUIDITY_PROMPT",
  "fundamental-workers/earnings-context": "FUNDAMENTAL_WORKERS_EARNINGS_CONTEXT_PROMPT",
  "fundamental-workers/catalyst-context": "FUNDAMENTAL_WORKERS_CATALYST_CONTEXT_PROMPT",
  "fundamental-workers/sentiment-context": "FUNDAMENTAL_WORKERS_SENTIMENT_CONTEXT_PROMPT",
  "fundamental-workers/event-resolution": "FUNDAMENTAL_WORKERS_EVENT_RESOLUTION_PROMPT",
  "fundamental-workers/event-catalyst": "FUNDAMENTAL_WORKERS_EVENT_CATALYST_PROMPT",
  "fundamental-workers/event-sentiment": "FUNDAMENTAL_WORKERS_EVENT_SENTIMENT_PROMPT",
  "decision-workers/signal-classifier": "DECISION_WORKERS_SIGNAL_CLASSIFIER_PROMPT",
  "decision-workers/entry-timer": "DECISION_WORKERS_ENTRY_TIMER_PROMPT",
  "review-workers/conflict-detector": "REVIEW_WORKERS_CONFLICT_DETECTOR_PROMPT",
  "review-workers/risk-assessor": "REVIEW_WORKERS_RISK_ASSESSOR_PROMPT",
};

function patchFile(filePath, importPath) {
  let content = fs.readFileSync(filePath, "utf8");
  const used = new Set();
  for (const [assetPath, constName] of Object.entries(PROMPT_MAP)) {
    const re = new RegExp(
      `promptAssetPath:\\s*"${assetPath.replace(/\//g, "\\/")}"`,
      "g",
    );
    if (re.test(content)) {
      used.add(constName);
      content = content.replace(
        re,
        `prompt: ${constName}`,
      );
    }
  }
  if (used.size === 0) return;
  const importNames = [...used].sort().join(",\n  ");
  const importBlock = `import {\n  ${importNames},\n} from "${importPath}";\n`;
  if (!content.includes('from "./worker-prompts"') && !content.includes('from "../worker-prompts"')) {
    const firstImport = content.indexOf("import ");
    content = content.slice(0, firstImport) + importBlock + content.slice(firstImport);
  }
  fs.writeFileSync(filePath, content);
  console.log(`Patched ${filePath} (${used.size} prompts)`);
}

patchFile(
  path.join(ROOT, "electron/main/services/pipeline/pipeline-discovery-config.ts"),
  "./worker-prompts",
);
patchFile(
  path.join(ROOT, "electron/main/services/pipeline/definitions/decision.phase.ts"),
  "../worker-prompts",
);
patchFile(
  path.join(ROOT, "electron/main/services/pipeline/definitions/review.phase.ts"),
  "../worker-prompts",
);
patchFile(
  path.join(ROOT, "electron/main/services/pipeline/implementations/selector/plan.ts"),
  "../../worker-prompts",
);

// Global replace in remaining ts files
function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (name === "node_modules" || name === "prompts") continue;
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p);
    else if (name.endsWith(".ts") && !name.includes("worker-prompts")) {
      let c = fs.readFileSync(p, "utf8");
      const o = c;
      c = c.replace(/promptAssetPath/g, "prompt");
      if (c !== o) fs.writeFileSync(p, c);
    }
  }
}
walk(path.join(ROOT, "electron"));
walk(path.join(ROOT, "src"));

console.log("Global promptAssetPath -> prompt done");
