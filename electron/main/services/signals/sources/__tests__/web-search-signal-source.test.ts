import { describe, expect, it } from "vitest";
import { WebSearchSignalSource } from "../web-search-signal-source";

describe("WebSearchSignalSource", () => {
  it("defaults instrument classes to stock", async () => {
    const source = new WebSearchSignalSource("web-1");
    await source.start();

    expect(source.configuredInstrumentClasses()).toEqual(["stock"]);
    expect(source.status).toBe("running");

    await source.stop();
    expect(source.status).toBe("paused");
  });

  it("restarts with updated config", async () => {
    const source = new WebSearchSignalSource(
      "web-2",
      JSON.stringify({ instrumentClasses: ["stock", "crypto"] }),
    );

    await source.restart({ instrumentClasses: ["futures"] });

    expect(source.configuredInstrumentClasses()).toEqual(["futures"]);
    expect(source.status).toBe("running");
  });

  it("returns an empty poll result from test()", async () => {
    const source = new WebSearchSignalSource("web-3");
    await expect(source.test()).resolves.toEqual({
      detected: 0,
      passed: 0,
      dropped: 0,
      errors: [],
    });
  });
});
