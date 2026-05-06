import type { InstrumentClass } from "@/lib/types";
import { AppError } from "@electron/shared/errors";
import type { BrokerAccountsRepo } from "../../db/repositories/broker-accounts-repo";
import type { BrokerRoutingRepo } from "../../db/repositories/broker-routing-repo";
import type { SessionBrokerAssignmentsRepo } from "../../db/repositories/session-broker-assignments-repo";
import type { BrokerRegistry } from "./broker-registry";
import type { BrokerAdapter } from "./adapters/broker-adapter";

export class BrokerRoutingService {
  constructor(
    private readonly brokerAccountsRepo: BrokerAccountsRepo,
    private readonly sessionBrokerAssignmentsRepo: SessionBrokerAssignmentsRepo,
    private readonly brokerRoutingRepo: BrokerRoutingRepo,
    private readonly registry: BrokerRegistry,
  ) {}

  /**
   * Session override → workspace default → single compatible assignment fallback.
   * Throws if no compatible broker, routing is ambiguous, or resolved broker is not allowed for the session.
   */
  resolveBrokerAccountId(sessionId: string, instrumentClass: InstrumentClass): string {
    const compatible = this.compatibleAssignmentIds(sessionId, instrumentClass);
    if (compatible.length === 0) {
      throw new AppError("No compatible broker for this instrument class", "NO_BROKER", {
        sessionId,
        instrumentClass,
      });
    }

    const routed = this.brokerRoutingRepo.resolveBrokerAccountId(sessionId, instrumentClass);
    let chosen: string | null = routed;

    if (chosen && !compatible.includes(chosen)) {
      throw new AppError(
        `Resolved broker ${chosen} does not support ${instrumentClass} or is not assigned to this session.`,
        "ROUTING_AMBIGUOUS",
        { brokerAccountId: chosen, instrumentClass },
      );
    }

    if (!chosen) {
      if (compatible.length === 1) {
        const only = compatible[0];
        if (!only) throw new AppError("No compatible broker for this instrument class", "NO_BROKER", { sessionId, instrumentClass });
        chosen = only;
      } else {
        throw new AppError(
          `No routing default configured for ${instrumentClass} and multiple brokers are compatible.`,
          "ROUTING_AMBIGUOUS",
          { instrumentClass, compatible },
        );
      }
    }

    return chosen;
  }

  async resolveAdapter(
    sessionId: string,
    instrumentClass: InstrumentClass,
  ): Promise<{ adapter: BrokerAdapter; brokerAccountId: string }> {
    const brokerAccountId = this.resolveBrokerAccountId(sessionId, instrumentClass);
    const adapter = await this.registry.get(brokerAccountId);
    return { adapter, brokerAccountId };
  }

  async preflightSession(sessionId: string, instrumentClasses: InstrumentClass[]): Promise<void> {
    const unique = [...new Set(instrumentClasses)];
    for (const cls of unique) {
      await this.resolveAdapter(sessionId, cls);
    }

    const assignments = this.sessionBrokerAssignmentsRepo.listBrokerAccountIds(sessionId);
    for (const brokerAccountId of assignments) {
      const adapter = await this.registry.get(brokerAccountId);
      const result = await adapter.testConnection();
      if (!result.ok) {
        throw new AppError(
          `Broker ${brokerAccountId} connection failed: ${result.message}`,
          "BROKER_UNREACHABLE",
          { brokerAccountId, detail: result.message },
        );
      }
    }
  }

  private compatibleAssignmentIds(sessionId: string, instrumentClass: InstrumentClass): string[] {
    const assignments = this.sessionBrokerAssignmentsRepo.listBrokerAccountIds(sessionId);
    return assignments.filter((id) => {
      const account = this.brokerAccountsRepo.find(id);
      return account?.supportedInstrumentClasses.includes(instrumentClass) ?? false;
    });
  }
}
