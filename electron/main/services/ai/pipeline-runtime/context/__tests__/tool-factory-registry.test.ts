import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  buildToolSet,
  type TerminalOutputToolSpec,
  type ToolBuildContext,
} from "../tool-factory-registry";

const ctx = {} as ToolBuildContext;

const outputTool: TerminalOutputToolSpec = {
  name: "submit_result",
  description: "submit",
  schema: z.object({ score: z.number(), label: z.string() }),
};

describe("buildToolSet terminal output tool", () => {
  it("returns undefined when no tools and no output tool are configured", async () => {
    expect(await buildToolSet([], ctx, undefined)).toBeUndefined();
  });

  it("registers the configured terminal tool under its name even without data tools", async () => {
    const tools = await buildToolSet([], ctx, outputTool);
    expect(tools).toBeDefined();
    expect(Object.keys(tools ?? {})).toEqual(["submit_result"]);
  });

  it("honors a custom terminal tool name", async () => {
    const tools = await buildToolSet([], ctx, {
      ...outputTool,
      name: "finalize",
    });
    expect(Object.keys(tools ?? {})).toContain("finalize");
  });

  it("echoes the validated input as the terminal tool result", async () => {
    const tools = await buildToolSet([], ctx, outputTool);
    const submit = tools?.submit_result;
    const payload = { score: 0.7, label: "ok" };
    const result = await submit?.execute?.(payload, {
      toolCallId: "t1",
      messages: [],
    });
    expect(result).toEqual(payload);
  });

  it("does not register the legacy submit_candidates tool", async () => {
    const tools = await buildToolSet([], ctx, outputTool);
    expect(tools).not.toHaveProperty("submit_candidates");
  });
});
