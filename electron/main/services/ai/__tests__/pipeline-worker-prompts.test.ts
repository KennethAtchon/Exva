import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const PROMPTS_DIR = path.join(
  import.meta.dirname,
  "../pipeline-runtime/prompts",
);

const BANNED = [
  /first do .+ then/i,
  /if .+ fails?,? try/i,
  /you are operating inside exva/i,
  /submit_candidates/i,
];

function walkMarkdownFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkMarkdownFiles(full));
    else if (entry.name.endsWith(".md")) files.push(full);
  }
  return files;
}

describe("pipeline worker prompts", () => {
  const files = walkMarkdownFiles(PROMPTS_DIR);

  it("has at least one worker prompt asset", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const file of files) {
    const name = path.relative(PROMPTS_DIR, file);
    it(`${name} stays within 1600 characters`, () => {
      const content = fs.readFileSync(file, "utf8");
      expect(content.length).toBeLessThanOrEqual(1600);
    });

    it(`${name} avoids banned orchestration phrases`, () => {
      const content = fs.readFileSync(file, "utf8");
      for (const pattern of BANNED) {
        expect(content).not.toMatch(pattern);
      }
    });
  }
});
