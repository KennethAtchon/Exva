import type { InstrumentClass, SessionTemplatePayload } from "@/lib/types";
import { sessionTemplatePayloadSchema, templateCreateInputSchema } from "@electron/shared/validation/schemas";
import { AppError } from "@electron/shared/infra/errors";
import type { BrokerAccountsRepo } from "../../db/repositories/broker-accounts-repo";
import type { ProviderAccountsRepo } from "../../db/repositories/provider-accounts-repo";
import type { SessionBrokerAssignmentsRepo } from "../../db/repositories/session-broker-assignments-repo";
import type { BrokerRoutingRepo } from "../../db/repositories/broker-routing-repo";
import type { SessionRepo } from "../../db/repositories/session-repo";
import type { SessionSelectorSettingsRepo } from "../../db/repositories/session-selector-settings-repo";
import type { SessionTemplatesRepo } from "../../db/repositories/session-templates-repo";
import type { SessionStrategyContextService } from "./session-strategy-context-service";

export interface TemplateListItem {
  id: string;
  name: string;
  description: string | null;
  sourceSessionId: string | null;
  sourceSessionName: string | null;
  instrumentClasses: InstrumentClass[];
  updatedAt: string;
}

export interface TemplateApplyResult {
  payload: SessionTemplatePayload;
  clearedFields: string[];
}

export class SessionTemplateService {
  constructor(
    private readonly deps: {
      templates: SessionTemplatesRepo;
      sessions: SessionRepo;
      strategyContext: SessionStrategyContextService;
      selectorSettings: SessionSelectorSettingsRepo;
      brokerAssignments: SessionBrokerAssignmentsRepo;
      brokerRouting: BrokerRoutingRepo;
      providerAccounts: ProviderAccountsRepo;
      brokerAccounts: BrokerAccountsRepo;
    },
  ) {}

  list(filters: { search?: string; instrumentClass?: InstrumentClass } = {}): TemplateListItem[] {
    const sessionsById = new Map(
      this.deps.sessions.list({ includeArchived: true }).map((session) => [session.id, session]),
    );
    const search = filters.search?.toLowerCase().trim() ?? "";

    return this.deps.templates
      .list()
      .filter((template) => !search || template.name.toLowerCase().includes(search))
      .filter(
        (template) =>
          !filters.instrumentClass || template.instrumentClasses.includes(filters.instrumentClass),
      )
      .map((template) => ({
        id: template.id,
        name: template.name,
        description: template.description,
        sourceSessionId: template.sourceSessionId,
        sourceSessionName: template.sourceSessionId
          ? sessionsById.get(template.sourceSessionId)?.name ?? null
          : null,
        instrumentClasses: template.instrumentClasses,
        updatedAt: template.updatedAt,
      }));
  }

  create(input: {
    name: string;
    description?: string;
    sourceSessionId?: string;
    payload: SessionTemplatePayload;
  }): { id: string; updatedAt: string } {
    const parsed = templateCreateInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new AppError("Template payload is invalid.", "VALIDATION_FAILED", {
        issues: parsed.error.flatten(),
      });
    }
    return this.deps.templates.create({
      name: parsed.data.name.trim(),
      description: parsed.data.description?.trim(),
      sourceSessionId: parsed.data.sourceSessionId ?? null,
      payload: parsed.data.payload,
    });
  }

  delete(id: string): void {
    if (!this.deps.templates.delete(id)) {
      throw new AppError(`Template ${id} was not found`, "NOT_FOUND", { id });
    }
  }

  apply(id: string): TemplateApplyResult {
    const template = this.deps.templates.get(id);
    if (!template) {
      throw new AppError(`Template ${id} was not found`, "NOT_FOUND", { id });
    }

    const parsed = sessionTemplatePayloadSchema.safeParse(JSON.parse(template.templatePayloadJson));
    if (!parsed.success) {
      throw new AppError("Stored template payload is invalid.", "VALIDATION_FAILED", {
        templateId: id,
        issues: parsed.error.flatten(),
      });
    }

    const payload = parsed.data;
    const clearedFields: string[] = [];

    const providerIds = new Set(this.deps.providerAccounts.list().map((provider) => provider.id));
    const brokerIds = new Set(this.deps.brokerAccounts.list().map((broker) => broker.id));

    payload.brokerAssignments = payload.brokerAssignments.map((assignment, index) => {
      if (!brokerIds.has(assignment.brokerAccountId)) {
        clearedFields.push(`brokerAssignments[${index}]`);
        return { brokerAccountId: "", allocatedUsd: 0 };
      }
      return assignment;
    });

    const nextOverrides: Partial<Record<InstrumentClass, string>> = {};
    for (const [key, brokerAccountId] of Object.entries(payload.brokerOverridesByInstrumentClass)) {
      const ic = key as InstrumentClass;
      if (brokerAccountId && !brokerIds.has(brokerAccountId)) {
        clearedFields.push(`brokerOverridesByInstrumentClass.${ic}`);
        continue;
      }
      if (brokerAccountId) nextOverrides[ic] = brokerAccountId;
    }
    payload.brokerOverridesByInstrumentClass = nextOverrides;

    return { payload: payload as SessionTemplatePayload, clearedFields };
  }

  buildPayloadFromSession(sessionId: string): SessionTemplatePayload {
    const session = this.deps.sessions.requireById(sessionId);
    const strategyContext = this.deps.strategyContext.get(sessionId);
    const selector = this.deps.selectorSettings.get(sessionId);
    const overrides = this.deps.brokerRouting.listSessionOverrides(sessionId);

    return {
      version: 1,
      identity: {
        objective: session.objective,
        selectionMode: session.selectionMode,
        instrumentClasses: session.instrumentClasses,
        instrumentScope: session.instrumentScope,
        executionMode: session.executionMode,
        defaultSearchProviderId: session.defaultSearchProviderId,
      },
      selectorSettings: { aiPickerEnabled: selector.aiPickerEnabled },
      strategyContext,
      strategy: {
        strategyProfile: "custom",
        maxPositionUsd: strategyContext.riskConfig.maxPositionUsd,
        stopLossPct: strategyContext.riskConfig.stopLossPct ?? 0,
        takeProfitPct: strategyContext.riskConfig.takeProfitPct ?? 0,
        maxConcurrentTrades: strategyContext.riskConfig.maxConcurrentTrades,
        researchDepth: "balanced",
        dailyLossLimitUsd: strategyContext.riskConfig.dailyLossLimitUsd,
        profitTargetUsd: strategyContext.riskConfig.profitTargetUsd,
        maxAiSpendUsd: strategyContext.riskConfig.maxAiSpendUsd,
        humanApprovalRequired: strategyContext.riskConfig.humanApprovalRequired,
        primaryTradingTimeframe: strategyContext.timeframe.primaryTradingTimeframe,
        holdingStyle: strategyContext.timeframe.holdingStyle,
        targetHoldDays: strategyContext.timeframe.targetHoldDays,
        maxHoldDays: strategyContext.timeframe.maxHoldDays,
        timeframeNotes: strategyContext.timeframe.timeframeNotes,
      },
      brokerAssignments: this.deps.brokerAssignments.listAssignments(sessionId),
      brokerOverridesByInstrumentClass: Object.fromEntries(
        overrides.map((override) => [override.instrumentClass, override.brokerAccountId]),
      ) as Partial<Record<InstrumentClass, string>>,
    };
  }
}
