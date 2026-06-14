import { describe, expect, it, vi } from "vitest";
import { EventBus } from "../event-bus";
import { attachEventBusObserver } from "../event-bus-observer";
import { payloadMeta, textMeta } from "../log-safety";

const keytarStore = vi.hoisted(() => new Map<string, string>());

vi.mock("keytar", () => ({
  default: {
    setPassword: vi.fn(async (_svc: string, account: string, value: string) => {
      keytarStore.set(account, value);
    }),
    getPassword: vi.fn(
      async (_svc: string, account: string) => keytarStore.get(account) ?? null,
    ),
    deletePassword: vi.fn(async (_svc: string, account: string) => {
      keytarStore.delete(account);
    }),
  },
}));

vi.mock("electron", () => ({
  Notification: {
    isSupported: () => false,
  },
}));

describe("EventBus", () => {
  it("subscribes, publishes, and unsubscribes without leaks", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const unsubscribe = bus.on("session_status_changed", handler);

    bus.emit("session_status_changed", {
      sessionId: "s1",
      status: "active",
    });
    expect(handler).toHaveBeenCalledTimes(1);

    unsubscribe();
    bus.emit("session_status_changed", {
      sessionId: "s1",
      status: "paused",
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("tracks runtime status per session", () => {
    const bus = new EventBus();
    expect(bus.runtimeStatus("s1")).toBeNull();
    bus.setRuntimeStatus("s1", "active");
    expect(bus.runtimeStatus("s1")).toBe("active");
    bus.clearRuntimeStatus("s1");
    expect(bus.runtimeStatus("s1")).toBeNull();
  });
});

describe("attachEventBusObserver", () => {
  it("logs events without throwing", () => {
    const bus = new EventBus();
    const info = vi.fn();
    const error = vi.fn();
    const logger = {
      child: () => ({ info, warn: vi.fn(), error, debug: vi.fn() }),
    } as never;

    const detach = attachEventBusObserver(bus, logger);
    bus.emit("research_phase_started", {
      sessionId: "s1",
      phase: "technical",
      cycleId: "c1",
    });
    bus.emit("step:failed", {
      sessionId: "s1",
      cycleId: "c1",
      stage: "broker_order",
      retryable: true,
      errorCode: "BROKER_UNREACHABLE",
      errorMessage: "timeout",
      nextRetryAt: null,
    });
    expect(info).toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    detach();
  });
});

describe("SecretsService", () => {
  it("save/retrieve/delete via mocked keytar", async () => {
    keytarStore.clear();
    const { SecretsService } = await import("../secrets-service");
    const service = new SecretsService();
    await service.set("exva:anthropic", "sk-test-key");
    expect(await service.get("exva:anthropic")).toBe("sk-test-key");
    expect(await service.has("exva:anthropic")).toBe(true);
    await service.delete("exva:anthropic");
    expect(await service.get("exva:anthropic")).toBeNull();
  });
});

describe("log-safety", () => {
  it("detects sensitive keys in payloads", () => {
    const meta = payloadMeta({
      user: "ken",
      apiKey: "secret-value",
      nested: { accessToken: "tok" },
    });
    expect(meta.sensitiveKeyDetected).toBe(true);
    expect(meta.sensitiveKeyCount).toBeGreaterThan(0);
  });

  it("flags sensitive text patterns", () => {
    expect(textMeta("api_key=sk-live-abc123").looksSensitive).toBe(true);
    expect(textMeta("normal log line").looksSensitive).toBe(false);
  });
});

describe("NotificationService", () => {
  it("emits notification event on trade/approval alerts", async () => {
    const { NotificationService } = await import("../notification-service");
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on("notification", handler);
    const service = new NotificationService(bus);
    service.notify("Trade opened", "AAPL long", "INFO");
    expect(handler).toHaveBeenCalledWith({
      title: "Trade opened",
      body: "AAPL long",
      level: "INFO",
    });
  });
});
