import type {
  InstrumentClass,
  TradingTimeframe,
} from "@electron/shared/domain/enums";
import type { InstrumentSetService } from "../instruments/instrument-set-service";
import type { SessionInputRuntimePlanner } from "../scheduling/session-input-runtime-planner";
import type { SessionInputSubscriptionRepo } from "../session-inputs/session-input-subscription-repo";
import type { StrategyDefinitionRegistry } from "../strategies/strategy-definition-registry";
import type { BrokerRoutingService } from "../broker/broker-routing-service";
import type {
  HistoryProvisioningService,
  InstrumentHistoryContract,
} from "./history-provisioning-service";

interface ScheduledHistoryProvisioningDeps {
  planner: Pick<SessionInputRuntimePlanner, "buildPlans">;
  subscriptions: Pick<SessionInputSubscriptionRepo, "listEnabledBySession">;
  instrumentSets: Pick<InstrumentSetService, "getRevision">;
  strategies: Pick<StrategyDefinitionRegistry, "require">;
  brokerRouting: Pick<BrokerRoutingService, "resolveBrokerAccountId">;
  history: Pick<HistoryProvisioningService, "ensure">;
}

interface ProvisioningTarget {
  symbol: string;
  instrumentClass: InstrumentClass;
  timeframe: TradingTimeframe;
  brokerAccountId: string;
  contract: InstrumentHistoryContract;
}

/** Provisions the exact OHLCV lanes an activated session's scheduler will read. */
export class ScheduledHistoryProvisioningService {
  constructor(private readonly deps: ScheduledHistoryProvisioningDeps) {}

  async ensureSession(sessionId: string): Promise<void> {
    const subscriptionIds = new Set(
      this.deps.subscriptions
        .listEnabledBySession(sessionId)
        .filter((subscription) => subscription.mode === "scheduled_scan")
        .map((subscription) => subscription.id),
    );
    if (subscriptionIds.size === 0) return;

    const targets = new Map<string, ProvisioningTarget>();
    const plans = this.deps.planner
      .buildPlans()
      .filter((plan) =>
        plan.subscriptionIds.some((id) => subscriptionIds.has(id)),
      );

    for (const plan of plans) {
      // Options flow reads an option-chain snapshot instead of OHLCV bars.
      if (plan.strategyId === "options-flow") continue;

      const revision = this.deps.instrumentSets.getRevision(
        plan.instrumentSetId,
        plan.instrumentSetRevision,
      );
      if (!revision) {
        throw new Error(
          `Cannot provision scheduled history: instrument set ${plan.instrumentSetId}@${plan.instrumentSetRevision} was not found`,
        );
      }

      const definition = this.deps.strategies.require(plan.strategyId);
      const strategy = definition.create(plan.strategyParameters);
      const contract: InstrumentHistoryContract = {
        minEvaluableBars: definition.requiredBarCount,
        preferredContextBars: Math.max(
          definition.requiredBarCount * 4,
          strategy.warmupBars + 1,
          250,
        ),
        warmupBars: strategy.warmupBars,
      };
      const brokerAccountId = this.deps.brokerRouting.resolveBrokerAccountId(
        sessionId,
        revision.instrumentClass,
      );

      for (const member of revision.members) {
        const target: ProvisioningTarget = {
          symbol: member.displaySymbol,
          instrumentClass: revision.instrumentClass,
          timeframe: plan.analysisTimeframe,
          brokerAccountId,
          contract,
        };
        const key = [
          target.symbol,
          target.instrumentClass,
          target.timeframe,
          target.brokerAccountId,
        ].join(":");
        const existing = targets.get(key);
        if (existing) {
          existing.contract = {
            minEvaluableBars: Math.max(
              existing.contract.minEvaluableBars,
              contract.minEvaluableBars,
            ),
            preferredContextBars: Math.max(
              existing.contract.preferredContextBars,
              contract.preferredContextBars,
            ),
            warmupBars: Math.max(
              existing.contract.warmupBars,
              contract.warmupBars,
            ),
          };
        } else {
          targets.set(key, target);
        }
      }
    }

    for (const target of targets.values()) {
      const result = await this.deps.history.ensure(target);
      const hasMinimum =
        result.kind !== "unavailable" &&
        result.storedBars >= target.contract.minEvaluableBars;
      if (!hasMinimum) {
        // `satisfied` carries no reason; it can only land here if it reported
        // fewer bars than the strategy contract requires.
        const reason =
          result.kind === "satisfied"
            ? `only ${result.storedBars} stored bars, need ${target.contract.minEvaluableBars}`
            : result.reason;
        throw new Error(
          `Scheduled history unavailable for ${target.symbol} ${target.timeframe}: ${reason}`,
        );
      }
    }
  }
}
