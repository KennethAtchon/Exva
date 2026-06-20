import "./ipc-electron-mock";
import { afterEach, describe, expect, it, vi } from "vitest";
import { channels } from "@electron/shared/ipc/channels";
import { registerAccountHandlers } from "../workspace/accounts";
import {
  createIpcTestServices,
  invokeIpc,
  resetIpcHandlers,
} from "./ipc-test-harness";

describe("accounts broker onboarding IPC", () => {
  let cleanup: (() => void) | null = null;

  afterEach(() => {
    resetIpcHandlers();
    cleanup?.();
    cleanup = null;
  });

  it("warms the broker balance cache before returning a successful onboard", async () => {
    const harness = createIpcTestServices();
    cleanup = harness.cleanup;
    harness.services.secrets = { set: vi.fn(async () => undefined) } as never;
    harness.services.brokerRegistry = {
      buildEphemeral: vi.fn(async () => ({
        testConnection: async () => ({ ok: true as const, message: "ok" }),
        getAccountBalance: async () => 12_500,
      })),
      invalidate: vi.fn(),
    } as never;
    registerAccountHandlers(harness.services);

    const response = await invokeIpc<{ ok: true; id: string }>(
      channels.accounts.addBroker,
      {
        id: "broker-onboarded",
        brokerType: "alpaca",
        name: "Fresh Alpaca Broker",
        mode: "paper",
        credentials: { apiKey: "key", secretKey: "secret" },
      },
    );

    const broker = harness.services.repos.brokerAccounts.require(response.id);
    expect(broker.balanceCacheUsd).toBe(12_500);
    expect(broker.balanceCachedAt).toEqual(expect.any(String));
  });
});
