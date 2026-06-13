import type { DbClient } from "../../client";
import type {
  AllocationEnforcement,
  BrokerAccount,
  BrokerMode,
  InstrumentClass,
} from "@/lib/types";
import {
  DEFAULT_MOCK_ACCOUNT_BALANCE_USD,
  DEFAULT_MOCK_EXECUTION_TIER,
  DEFAULT_MOCK_SCENARIO_KIND,
  type MockExecutionTier,
  type MockScenarioKind,
} from "@electron/shared/domain/mock-scenario";
import { asc, eq } from "drizzle-orm";
import { AppError } from "@electron/shared/infra/errors";
import { brokerAccounts } from "../../schema";
import { toBrokerAccount } from "../system/mappers";

export class BrokerAccountsRepo {
  constructor(private readonly client: DbClient) {}

  list(): BrokerAccount[] {
    const rows = this.client.db
      .select()
      .from(brokerAccounts)
      .orderBy(asc(brokerAccounts.name))
      .all();
    return rows.map(toBrokerAccount);
  }

  find(id: string): BrokerAccount | null {
    const row = this.client.db
      .select()
      .from(brokerAccounts)
      .where(eq(brokerAccounts.id, id))
      .get();
    return row ? toBrokerAccount(row) : null;
  }

  require(id: string): BrokerAccount {
    const account = this.find(id);
    if (!account)
      throw new AppError(`Broker account ${id} was not found`, "NOT_FOUND", {
        id,
      });
    return account;
  }

  insert(input: {
    id: string;
    name: string;
    brokerType: string;
    supportedInstrumentClasses: InstrumentClass[];
    mode: BrokerMode;
    secretRef: string;
    mockScenarioKind?: MockScenarioKind | null;
    mockExecutionTier?: MockExecutionTier | null;
  }): BrokerAccount {
    const now = new Date().toISOString();
    const mockScenarioKind =
      input.brokerType === "mock"
        ? (input.mockScenarioKind ?? DEFAULT_MOCK_SCENARIO_KIND)
        : null;
    const mockExecutionTier =
      input.brokerType === "mock"
        ? (input.mockExecutionTier ?? DEFAULT_MOCK_EXECUTION_TIER)
        : null;
    this.client.db
      .insert(brokerAccounts)
      .values({
        id: input.id,
        name: input.name,
        brokerType: input.brokerType,
        supportedInstrumentClasses: JSON.stringify(
          input.supportedInstrumentClasses,
        ),
        mode: input.mode,
        mockScenarioKind,
        mockExecutionTier,
        balanceCacheUsd:
          input.brokerType === "mock" ? DEFAULT_MOCK_ACCOUNT_BALANCE_USD : null,
        balanceCachedAt: input.brokerType === "mock" ? now : null,
        secretRef: input.secretRef,
        updatedAt: now,
      })
      .run();
    return this.require(input.id);
  }

  delete(id: string): void {
    this.client.db
      .delete(brokerAccounts)
      .where(eq(brokerAccounts.id, id))
      .run();
  }

  updateBalanceCache(
    id: string,
    balanceCacheUsd: number,
    balanceCachedAt: string,
  ): void {
    this.client.db
      .update(brokerAccounts)
      .set({
        balanceCacheUsd,
        balanceCachedAt,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(brokerAccounts.id, id))
      .run();
  }

  getBalanceCache(id: string): {
    balanceCacheUsd: number | null;
    balanceCachedAt: string | null;
  } {
    const row = this.client.db
      .select({
        balanceCacheUsd: brokerAccounts.balanceCacheUsd,
        balanceCachedAt: brokerAccounts.balanceCachedAt,
      })
      .from(brokerAccounts)
      .where(eq(brokerAccounts.id, id))
      .get();
    return {
      balanceCacheUsd: row?.balanceCacheUsd ?? null,
      balanceCachedAt: row?.balanceCachedAt ?? null,
    };
  }

  updateSettings(
    id: string,
    patch: {
      maxSessions?: number;
      allocationEnforcement?: AllocationEnforcement;
      balanceRefreshIntervalMin?: number;
      mockScenarioKind?: MockScenarioKind | null;
      mockExecutionTier?: MockExecutionTier | null;
    },
  ): void {
    const account = this.require(id);
    const { mockScenarioKind, mockExecutionTier, ...rest } = patch;
    this.client.db
      .update(brokerAccounts)
      .set({
        ...rest,
        ...(mockScenarioKind !== undefined && account.brokerType === "mock"
          ? { mockScenarioKind }
          : {}),
        ...(mockExecutionTier !== undefined && account.brokerType === "mock"
          ? { mockExecutionTier }
          : {}),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(brokerAccounts.id, id))
      .run();
  }
}
