import { describe, expect, it, vi } from "vitest";

const warnSpy = vi.fn();
const infoSpy = vi.fn();

vi.mock("../../infra/log", () => ({
  createLogger: () => ({
    warn: warnSpy,
    info: infoSpy,
  }),
}));

describe("withLLMRetry", () => {
  it("surfaces nested provider error details, walks the cause chain, and tags the provider", async () => {
    warnSpy.mockReset();
    infoSpy.mockReset();
    const { withLLMRetry } = await import("../runtime-retry");

    const error = Object.assign(
      new Error(
        "Failed after 3 attempts. Last error: Provider returned error",
        {
          cause: new Error("OpenRouter 400: Unsupported parameter: toolChoice"),
        },
      ),
      {
        statusCode: 400,
        responseBody: JSON.stringify({
          error: { message: "Unsupported parameter: toolChoice" },
        }),
        code: "BAD_REQUEST",
      },
    );

    const promise = withLLMRetry(
      async () => {
        throw error;
      },
      {
        providerType: "openrouter",
        modelId: "google/gemma-4-31b-it",
        role: "selector",
      },
    );

    await expect(promise).rejects.toMatchObject({
      code: "PROVIDER_UNREACHABLE",
      details: {
        retryable: false,
        providerType: "openrouter",
        modelId: "google/gemma-4-31b-it",
        attempts: 1,
        status: 400,
        rawMessage:
          "Failed after 3 attempts. Last error: Provider returned error",
        causeMessage: "OpenRouter 400: Unsupported parameter: toolChoice",
        responseBody:
          '{"error":{"message":"Unsupported parameter: toolChoice"}}',
        providerCode: "BAD_REQUEST",
      },
    });

    await expect(
      withLLMRetry(
        async () => {
          throw error;
        },
        { providerType: "openrouter" },
      ),
    ).rejects.toMatchObject({
      message: expect.stringMatching(
        /^openrouter provider unreachable after 1 attempt\(s\): /,
      ),
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        providerType: "openrouter",
        attempt: 1,
        retryable: false,
        providerErrorStatus: 400,
        providerErrorCode: "BAD_REQUEST",
        providerErrorCause: "OpenRouter 400: Unsupported parameter: toolChoice",
      }),
      "provider request attempt failed",
    );
  });

  it("logs each retry attempt and recovers on the second try for transient errors", async () => {
    warnSpy.mockReset();
    infoSpy.mockReset();
    const { withLLMRetry } = await import("../runtime-retry");

    let calls = 0;
    const result = await withLLMRetry(
      async () => {
        calls += 1;
        if (calls === 1) {
          throw Object.assign(new Error("fetch failed"), { statusCode: 503 });
        }
        return "ok";
      },
      { providerType: "openrouter" },
    );

    expect(result).toBe("ok");
    expect(calls).toBe(2);
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({ providerType: "openrouter", attempt: 1 }),
      "provider request attempt",
    );
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({ providerType: "openrouter", attempt: 2 }),
      "provider request attempt",
    );
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({ providerType: "openrouter", attempt: 2 }),
      "provider request recovered",
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        providerType: "openrouter",
        attempt: 1,
        willRetry: true,
      }),
      "provider request attempt failed",
    );
  });

  it("treats timed out responses as retryable provider errors", async () => {
    warnSpy.mockReset();
    infoSpy.mockReset();
    const { withLLMRetry } = await import("../runtime-retry");

    let calls = 0;
    const result = await withLLMRetry(async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("AI request timed out");
      }
      return "ok";
    });

    expect(result).toBe("ok");
    expect(calls).toBe(2);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 1, retryable: true, willRetry: true }),
      "provider request attempt failed",
    );
  });

  it("exhausts 4 retries with backoff 1s→8s before surfacing PROVIDER_UNREACHABLE", async () => {
    vi.useFakeTimers();
    warnSpy.mockReset();
    infoSpy.mockReset();
    const { withLLMRetry } = await import("../runtime-retry");

    let calls = 0;
    const promise = withLLMRetry(async () => {
      calls += 1;
      throw Object.assign(new Error("service unavailable"), {
        statusCode: 503,
      });
    });

    const assertion = expect(promise).rejects.toMatchObject({
      code: "PROVIDER_UNREACHABLE",
      details: { retryable: true, attempts: 5 },
    });

    await vi.advanceTimersByTimeAsync(
      60_000 +
        1_000 +
        60_000 +
        2_000 +
        60_000 +
        4_000 +
        60_000 +
        8_000 +
        60_000,
    );

    await assertion;
    expect(calls).toBe(5);
    const attemptFailedLogs = warnSpy.mock.calls.filter(
      (call) => call[1] === "provider request attempt failed",
    );
    expect(attemptFailedLogs).toHaveLength(5);
    expect(
      attemptFailedLogs.filter((call) => call[0]?.willRetry === true),
    ).toHaveLength(4);
    expect(attemptFailedLogs[4]?.[0]).toMatchObject({
      attempt: 5,
      willRetry: false,
    });
    vi.useRealTimers();
  });

  it("aborts each timed-out provider attempt before moving to the next retry", async () => {
    vi.useFakeTimers();
    warnSpy.mockReset();
    infoSpy.mockReset();
    const { withLLMRetry } = await import("../runtime-retry");

    const signals: AbortSignal[] = [];
    const promise = withLLMRetry(
      (abortSignal) => {
        signals.push(abortSignal);
        return new Promise<string>(() => undefined);
      },
      { providerType: "openrouter" },
    );
    const assertion = expect(promise).rejects.toMatchObject({
      code: "PROVIDER_UNREACHABLE",
      details: { retryable: true, attempts: 5 },
    });

    await vi.advanceTimersByTimeAsync(
      60_000 +
        1_000 +
        60_000 +
        2_000 +
        60_000 +
        4_000 +
        60_000 +
        8_000 +
        60_000,
    );

    await assertion;
    expect(signals).toHaveLength(5);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
});
