import { describe, expect, it } from "vitest";
import { createLogger } from "../log";

describe("createLogger", () => {
  it("creates scoped loggers with standard levels", () => {
    const logger = createLogger("test-scope");
    expect(logger.info).toBeTypeOf("function");
    expect(logger.warn).toBeTypeOf("function");
    expect(logger.error).toBeTypeOf("function");
    expect(() => logger.info({ test: true }, "hello")).not.toThrow();
  });
});
