#!/usr/bin/env node
/** Pass 8: fix depth-1 top-level service files (llm, tools, replay, search, instrument). */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const S = join(new URL("..", import.meta.url).pathname, "electron/main/services");

const files = {
  [`${S}/llm/runtime.ts`]: (c) =>
    c
      .replace(/from "\.\.\/\.\.\/pipeline\//g, 'from "../pipeline/')
      .replace(/from "\.\.\/\.\.\/broker\//g, 'from "../broker/'),
  [`${S}/llm/runtime-retry.ts`]: (c) =>
    c.replace('from "../../infra/log"', 'from "../infra/log"'),
  [`${S}/llm/provider-registry.ts`]: (c) =>
    c.replace('from "../../infra/secrets-service"', 'from "../infra/secrets-service"'),
  [`${S}/search/search-registry.ts`]: (c) =>
    c.replace('from "../../infra/secrets-service"', 'from "../infra/secrets-service"'),
  [`${S}/instrument/instrument-cache-service.ts`]: (c) =>
    c.replace(/from "\.\.\/\.\.\/pipeline\//g, 'from "../pipeline/'),
  [`${S}/tools/market-tools.ts`]: (c) =>
    c.replace(/from "\.\.\/\.\.\/broker\//g, 'from "../broker/'),
  [`${S}/tools/fetch-url-tool.ts`]: (c) =>
    c.replace(/from "\.\.\/\.\.\/broker\//g, 'from "../broker/'),
  [`${S}/tools/search-tool.ts`]: (c) =>
    c.replace(/from "\.\.\/\.\.\/broker\//g, 'from "../broker/'),
  [`${S}/replay/cycle-replay-service.ts`]: (c) =>
    c
      .replace(/from "\.\.\/\.\.\/broker\//g, 'from "../broker/')
      .replace(/from "\.\.\/\.\.\/orchestration\//g, 'from "../orchestration/')
      .replace(/from "\.\.\/\.\.\/risk\//g, 'from "../risk/')
      .replace(/from "\.\.\/\.\.\/signal\//g, 'from "../signal/'),
  [`${S}/pipeline/worker-tools/resolve-mock-tool-context.ts`]: (c) =>
    c.replace(/from "\.\.\/\.\.\/\.\.\/broker\//g, 'from "../../broker/'),
  [`${S}/pipeline/worker-tools/tool-factory-registry.ts`]: (c) =>
    c.replace(/from "\.\.\/\.\.\/\.\.\/broker\//g, 'from "../../broker/'),
  [`${S}/signal/scoring/selector-risk-filter.ts`]: (c) =>
    c.replace(/from "\.\.\/\.\.\/\.\.\/broker\//g, 'from "../../broker/'),
  [`${S}/pipeline/implementations/registry/registry.ts`]: (c) =>
    c.replace(/import\("\.\.\/cycle\/types"\)/g, 'import("../../analysis/types")'),
  [`${S}/session/__tests__/runtime-manager.test.ts`]: (c) =>
    c.replace('from "../risk/', 'from "../../risk/'),
  [`${S}/session/__tests__/session-onboarding.integration.test.ts`]: (c) =>
    c
      .replace('from "../broker/', 'from "../../broker/')
      .replace('from "../../../broker/', 'from "../../broker/'),
};

let changed = 0;
for (const [file, fix] of Object.entries(files)) {
  const content = readFileSync(file, "utf8");
  const next = fix(content);
  if (next !== content) {
    writeFileSync(file, next);
    changed++;
  }
}
console.log(`Pass 8 fixed ${changed} files`);
