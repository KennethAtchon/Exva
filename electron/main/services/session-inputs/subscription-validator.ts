import type {
  SessionInputSubscriptionDraft,
  EventSourceSubscriptionDraft,
  ScheduledScanSubscriptionDraft,
} from "@electron/shared/domain/experience-inputs/subscription";
import type {
  ValidationResult,
  SessionDraftValidation,
  FieldError,
  FieldWarning,
} from "@electron/shared/domain/experience-inputs/validation-result";
import { validationResult } from "@electron/shared/domain/experience-inputs/validation-result";
import type { ExperienceTemplateRepo } from "../experience-catalog/experience-template-repo";
import type { SourceDefinitionRepo } from "../signals/source-definition-repo";
import type { InstrumentSetRepo } from "../instruments/instrument-set-repo";
import type { CatalogValidator } from "../experience-catalog/catalog-validator";
import { cadenceToMs } from "@electron/shared/domain/experience-inputs/cadence";

const MIN_CADENCE_MS = 5 * 60 * 1_000; // 5 minutes hard floor

export class SubscriptionValidator {
  constructor(
    private readonly templateRepo: ExperienceTemplateRepo,
    private readonly sourceRepo: SourceDefinitionRepo,
    private readonly setRepo: InstrumentSetRepo,
    private readonly catalogValidator: CatalogValidator,
  ) {}

  validateDraft(
    draft: SessionInputSubscriptionDraft,
    index?: number,
  ): ValidationResult {
    const prefix = index !== undefined ? `subscriptions[${index}]` : "";
    const errors: FieldError[] = [];
    const warnings: FieldWarning[] = [];

    // Template must exist and be active
    const template = this.templateRepo.getRevision(
      draft.templateId,
      draft.templateVersion,
    );
    if (!template) {
      errors.push({
        field: `${prefix}.templateVersion`,
        code: "TEMPLATE_NOT_FOUND",
        message: `Template "${draft.templateId}" v${draft.templateVersion} not found.`,
      });
      return validationResult(errors, warnings);
    }

    if (template.status !== "active") {
      errors.push({
        field: `${prefix}.templateId`,
        code: "TEMPLATE_NOT_ACTIVE",
        message: `Template "${draft.templateId}" is not active (status: ${template.status}).`,
      });
    }

    // Template activation check (strategy, adapters)
    const templateResult =
      this.catalogValidator.validateTemplateActivation(template);
    for (const e of templateResult.errors) {
      errors.push({ ...e, field: `${prefix}.${e.field}` });
    }

    if (draft.mode === "event_source") {
      this.validateEventSource(
        draft as EventSourceSubscriptionDraft,
        prefix,
        errors,
      );
    } else if (draft.mode === "scheduled_scan") {
      this.validateScheduledScan(
        draft as ScheduledScanSubscriptionDraft,
        template,
        prefix,
        errors,
        warnings,
      );
    } else {
      errors.push({
        field: `${prefix}.mode`,
        code: "UNSUPPORTED_MODE",
        message: `Mode "${(draft as { mode: string }).mode}" is not supported.`,
      });
    }

    return validationResult(errors, warnings);
  }

  private validateEventSource(
    draft: EventSourceSubscriptionDraft,
    prefix: string,
    errors: FieldError[],
  ): void {
    const source = this.sourceRepo.get(draft.sourceDefinitionId);
    if (!source) {
      errors.push({
        field: `${prefix}.sourceDefinitionId`,
        code: "SOURCE_NOT_FOUND",
        message: `Source definition "${draft.sourceDefinitionId}" not found.`,
      });
      return;
    }

    const sourceResult = this.catalogValidator.validateSourceDefinition(source);
    for (const e of sourceResult.errors) {
      errors.push({ ...e, field: `${prefix}.${e.field}` });
    }

    const revision = this.sourceRepo.getRevision(
      draft.sourceDefinitionId,
      draft.sourceRevision,
    );
    if (!revision) {
      errors.push({
        field: `${prefix}.sourceRevision`,
        code: "REVISION_NOT_FOUND",
        message: `Source definition "${draft.sourceDefinitionId}" revision ${draft.sourceRevision} not found.`,
      });
    }
  }

  private validateScheduledScan(
    draft: ScheduledScanSubscriptionDraft,
    template: import("@electron/shared/domain/experience-inputs/catalog").ExperienceTemplateRevision,
    prefix: string,
    errors: FieldError[],
    warnings: FieldWarning[],
  ): void {
    // Cadence validation
    try {
      if (draft.cadence.kind === "interval") {
        const ms = cadenceToMs(draft.cadence);
        if (ms < MIN_CADENCE_MS) {
          errors.push({
            field: `${prefix}.cadence`,
            code: "CADENCE_TOO_FAST",
            message: `Cadence of ${ms / 60_000}m is below the minimum of ${MIN_CADENCE_MS / 60_000}m.`,
          });
        }
        // Strategy minimum cadence check
        if (template.strategyId) {
          const strategyMs = getStrategyMinCadenceMs(template.strategyId);
          if (strategyMs !== null && ms < strategyMs) {
            errors.push({
              field: `${prefix}.cadence`,
              code: "CADENCE_BELOW_STRATEGY_MINIMUM",
              message: `Cadence of ${ms / 60_000}m is below the strategy "${template.strategyId}" minimum of ${strategyMs / 60_000}m.`,
            });
          }
        }
      }
    } catch {
      // cron cadences don't support cadenceToMs — skip interval check
    }

    // Instrument set validation
    const rev = this.setRepo.getRevision(
      draft.instrumentSetId,
      draft.instrumentSetRevision,
    );
    if (!rev) {
      errors.push({
        field: `${prefix}.instrumentSetId`,
        code: "SET_NOT_FOUND",
        message: `Instrument set "${draft.instrumentSetId}" revision ${draft.instrumentSetRevision} not found.`,
      });
      return;
    }

    const setResult = this.catalogValidator.validateInstrumentSetForTemplate(
      rev,
      template,
    );
    for (const e of setResult.errors) {
      errors.push({ ...e, field: `${prefix}.${e.field}` });
    }

    const universeWarnings = this.catalogValidator.checkUniverseWarnings(
      rev,
      template,
    );
    for (const w of universeWarnings) {
      warnings.push({ ...w, field: `${prefix}.${w.field}` });
    }

    // Analysis timeframe must be in template contract
    const allowed = template.inputContract.analysisTimeframes;
    if (allowed.length > 0 && !allowed.includes(draft.analysisTimeframe)) {
      errors.push({
        field: `${prefix}.analysisTimeframe`,
        code: "TIMEFRAME_NOT_ALLOWED",
        message: `Analysis timeframe "${draft.analysisTimeframe}" is not in template's allowed timeframes: [${allowed.join(", ")}].`,
      });
    }
  }

  validateSessionDraft(input: {
    templateId: string;
    templateVersion: number;
    subscriptions: SessionInputSubscriptionDraft[];
  }): SessionDraftValidation {
    const subscriptionResults = input.subscriptions.map((draft, i) =>
      this.validateDraft(draft, i),
    );

    const allErrors = subscriptionResults.flatMap((r) => r.errors);
    const allWarnings = subscriptionResults.flatMap((r) => r.warnings);

    const usesUnvalidatedUniverse = subscriptionResults.some((r) =>
      r.warnings.some((w) => w.code === "OUTSIDE_VALIDATED_UNIVERSE"),
    );

    return {
      overall: validationResult(allErrors, allWarnings),
      subscriptionResults,
      usesUnvalidatedUniverse,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const KNOWN_STRATEGY_MIN_CADENCE_MS: Record<string, number> = {
  "mean-reversion": 5 * 60 * 1_000,
  breakout: 15 * 60 * 1_000,
  "trend-following": 15 * 60 * 1_000,
  "options-flow": 15 * 60 * 1_000,
};

function getStrategyMinCadenceMs(strategyId: string): number | null {
  return KNOWN_STRATEGY_MIN_CADENCE_MS[strategyId] ?? null;
}
