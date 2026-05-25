import fs from "node:fs";
import path from "node:path";

type RuleName =
  | "no-tiny-text"
  | "design-no-three-period-ellipsis"
  | "design-no-em-dash-in-jsx-text"
  | "design-no-redundant-size-axes"
  | "design-no-redundant-padding-axes";

type RuleResult = {
  code: string;
  replacements: number;
};

type FixRule = {
  name: RuleName;
  description: string;
  apply(code: string): RuleResult;
};

const ROOT = path.join(import.meta.dir, "..");
const DEFAULT_GLOB = "src/**/*.tsx";
const SAFE_RULES: RuleName[] = [
  "no-tiny-text",
  "design-no-three-period-ellipsis",
  "design-no-em-dash-in-jsx-text",
  "design-no-redundant-size-axes",
  "design-no-redundant-padding-axes",
];

const rules: Record<RuleName, FixRule> = {
  "no-tiny-text": {
    name: "no-tiny-text",
    description: "Raise 9/10/11px text to 12px",
    apply(code) {
      let replacements = 0;
      let next = code;

      next = next.replace(/fontSize:\s*(9|10|11)\b/g, () => {
        replacements += 1;
        return "fontSize: 12";
      });

      next = next.replace(/fontSize=\{(9|10|11)\}/g, () => {
        replacements += 1;
        return "fontSize={12}";
      });

      next = next.replace(/text-\[(9|10|11)px\]/g, () => {
        replacements += 1;
        return "text-[12px]";
      });

      return { code: next, replacements };
    },
  },
  "design-no-three-period-ellipsis": {
    name: "design-no-three-period-ellipsis",
    description: "Replace three-dot ellipsis with typographic ellipsis",
    apply(code) {
      let replacements = 0;
      const next = code.replace(/\.\.\./g, () => {
        replacements += 1;
        return "…";
      });
      return { code: next, replacements };
    },
  },
  "design-no-em-dash-in-jsx-text": {
    name: "design-no-em-dash-in-jsx-text",
    description: "Replace em dashes with commas",
    apply(code) {
      let replacements = 0;
      const next = code.replace(/—/g, () => {
        replacements += 1;
        return ",";
      });
      return { code: next, replacements };
    },
  },
  "design-no-redundant-size-axes": {
    name: "design-no-redundant-size-axes",
    description: "Collapse matching width/height Tailwind classes to size-*",
    apply(code) {
      let replacements = 0;
      const next = code.replace(
        /\bw-([\w.[\]-]+)\s+h-\1\b/g,
        (_match, size: string) => {
          replacements += 1;
          return `size-${size}`;
        },
      );
      return { code: next, replacements };
    },
  },
  "design-no-redundant-padding-axes": {
    name: "design-no-redundant-padding-axes",
    description: "Collapse matching px/py Tailwind classes to p-*",
    apply(code) {
      let replacements = 0;
      const next = code.replace(
        /\bpx-([\w.[\]-]+)\s+py-\1\b/g,
        (_match, size: string) => {
          replacements += 1;
          return `p-${size}`;
        },
      );
      return { code: next, replacements };
    },
  },
};

function parseArgs(argv: string[]) {
  const flags = new Set(argv);
  const ruleIndex = argv.indexOf("--rule");
  const globIndex = argv.indexOf("--glob");
  const rule = ruleIndex >= 0 ? argv[ruleIndex + 1] : null;
  const glob = globIndex >= 0 ? argv[globIndex + 1] : DEFAULT_GLOB;
  const dryRun = flags.has("--dry-run");
  const safe = flags.has("--safe") || !rule;

  const selectedRules = safe
    ? SAFE_RULES
    : rule && isRuleName(rule)
      ? [rule]
      : [];

  if (!safe && !rule) {
    throw new Error("Pass --safe or --rule <name>.");
  }
  if (rule && !isRuleName(rule)) {
    throw new Error(`Unknown rule '${rule}'.`);
  }

  return { dryRun, glob, selectedRules };
}

function isRuleName(value: string): value is RuleName {
  return value in rules;
}

async function listFiles(pattern: string): Promise<string[]> {
  const files: string[] = [];
  const glob = new Bun.Glob(pattern);
  for await (const relativePath of glob.scan({ cwd: ROOT, absolute: true })) {
    if (relativePath.includes("/components/ui/")) continue;
    files.push(relativePath);
  }
  files.sort();
  return files;
}

function applyRules(code: string, selectedRules: RuleName[]) {
  let next = code;
  const counts: Record<string, number> = {};

  for (const ruleName of selectedRules) {
    const result = rules[ruleName].apply(next);
    next = result.code;
    counts[ruleName] = result.replacements;
  }

  return { code: next, counts };
}

async function main() {
  const { dryRun, glob, selectedRules } = parseArgs(process.argv.slice(2));
  const files = await listFiles(glob);
  let changedFiles = 0;
  let totalReplacements = 0;

  const perRuleTotals = Object.fromEntries(
    selectedRules.map((ruleName) => [ruleName, 0]),
  ) as Record<RuleName, number>;

  for (const filePath of files) {
    const original = fs.readFileSync(filePath, "utf8");
    const result = applyRules(original, selectedRules);
    if (result.code === original) continue;

    changedFiles += 1;
    const relativePath = path.relative(ROOT, filePath);
    const fileReplacements = Object.values(result.counts).reduce(
      (sum, count) => sum + count,
      0,
    );
    totalReplacements += fileReplacements;

    for (const ruleName of selectedRules) {
      perRuleTotals[ruleName] += result.counts[ruleName] ?? 0;
    }

    if (!dryRun) {
      fs.writeFileSync(filePath, result.code);
    }

    console.log(
      `${dryRun ? "would update" : "updated"} ${relativePath} (${fileReplacements} replacement${fileReplacements === 1 ? "" : "s"})`,
    );
  }

  console.log("\nSummary");
  console.log(`files changed: ${changedFiles}`);
  console.log(`total replacements: ${totalReplacements}`);
  for (const ruleName of selectedRules) {
    console.log(`- ${ruleName}: ${perRuleTotals[ruleName]}`);
  }

  if (dryRun) {
    console.log("\nDry run only. No files were modified.");
  }
}

await main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : `Unknown error: ${String(error)}`,
  );
  process.exit(1);
});
