import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { shouldRunNightly } from "../supervisor-service";

describe("shouldRunNightly", () => {
  let tmpDir = "";
  let filePath = "";

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "exva-nightly-"));
    filePath = path.join(tmpDir, "last-nightly-run");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("is false before 08:00 local", () => {
    const d = new Date();
    d.setHours(7, 0, 0, 0);
    expect(shouldRunNightly(d.getTime(), filePath)).toBe(false);
  });

  it("is true at/after 08:00 when not yet run today", () => {
    const d = new Date();
    d.setHours(9, 0, 0, 0);
    expect(shouldRunNightly(d.getTime(), filePath)).toBe(true);
  });

  it("is false after persisted run for today", () => {
    const d = new Date();
    d.setHours(9, 0, 0, 0);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    fs.writeFileSync(filePath, `${y}-${m}-${day}\n`);
    expect(shouldRunNightly(d.getTime(), filePath)).toBe(false);
  });
});
