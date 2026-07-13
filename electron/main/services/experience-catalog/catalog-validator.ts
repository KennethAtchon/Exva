import type { ExperienceTemplateRevision } from "@electron/shared/domain/experience-inputs/catalog";
import type { SourceDefinition } from "@electron/shared/domain/experience-inputs/catalog";
import type { InstrumentSetRevision } from "@electron/shared/domain/experience-inputs/catalog";
import type { ValidationResult, FieldError } from "@electron/shared/domain/experience-inputs/validation-result";
import { validResult, validationResult } from "@electron/shared/domain/experience-inputs/validation-result";
import type { StrategyDefinitionRegistry } from "../strategies/strategy-definition-registry";
import type { SourceAdapterRegistry } from "../signals/adapters/source-adapter-registry";

export class CatalogValidator {
  constructor(
    private readonly strategyRegistry: StrategyDefinitionRegistry,
    private readonly adapterRegistry: SourceAdapterRegistry,
  ) {}

  /**
   * Validate that a template revision can be activated (i.e. subscriptions
   * can reference it).
   *
   * Checks:
   * - If strategyId is set, the strategy must exist and be non-disabled.
   * - If sourceKinds are required, each kind must be registered in the adapter registry.
   */
  validateTemplateActivation(
    revision: ExperienceTemplateRevision,
  ): ValidationResult {
    const errors: FieldError[] = [];

    if (revision.strategyId) {
      const def = this.strategyRegistry.get(revision.strategyId);
      if (!def) {
        errors.push({
          field: "strategyId",
          code: "STRATEGY_NOT_FOUND",
          message: `Strategy "${revision.strategyId}" is not registered.`,
        });
      } else if (def.implementationStatus === "disabled") {
        errors.push({
          field: "strategyId",
          code: "STRATEGY_DISABLED",
          message: `Strategy "${revision.strategyId}" is disabled and cannot be used for new subscriptions.`,
        });
      }
    }

    for (const kind of revision.inputContract.sourceKinds) {
      const adapter = this.adapterRegistry.get(kind);
      if (!adapter) {
        errors.push({
          field: `inputContract.sourceKinds`,
          code: "ADAPTER_NOT_FOUND",
          message: `Source adapter for kind "${kind}" is not registered.`,
        });
      }
    }

    return validationResult(errors);
  }

  /**
   * Validate that a source definition can be used in a subscription.
   */
  validateSourceDefinition(source: SourceDefinition): ValidationResult {
    const errors: FieldError[] = [];

    if (!source.enabled) {
      errors.push({
        field: "sourceDefinitionId",
        code: "SOURCE_DISABLED",
        message: `Source definition "${source.id}" is disabled.`,
      });
    }

    const adapter = this.adapterRegistry.get(source.kind);
    if (!adapter) {
      errors.push({
        field: "sourceDefinitionId",
        code: "ADAPTER_NOT_FOUND",
        message: `No adapter registered for source kind "${source.kind}".`,
      });
    }

    return validationResult(errors);
  }

  /**
   * Validate that an instrument set can be used in a scheduled-scan subscription.
   */
  validateInstrumentSetForTemplate(
    set: InstrumentSetRevision,
    template: ExperienceTemplateRevision,
  ): ValidationResult {
    const errors: FieldError[] = [];

    if (set.status !== "active") {
      errors.push({
        field: "instrumentSetId",
        code: "SET_NOT_ACTIVE",
        message: `Instrument set "${set.setId}" is not active (status: ${set.status}).`,
      });
    }

    const allowedClasses = template.inputContract.instrumentClasses;
    if (allowedClasses.length > 0 && !allowedClasses.includes(set.instrumentClass)) {
      errors.push({
        field: "instrumentSetId",
        code: "CLASS_MISMATCH",
        message: `Instrument set class "${set.instrumentClass}" is not in template's allowed classes: [${allowedClasses.join(", ")}].`,
      });
    }

    if (set.members.length === 0) {
      errors.push({
        field: "instrumentSetId",
        code: "SET_EMPTY",
        message: `Instrument set "${set.setId}" has no members.`,
      });
    }

    return validationResult(errors);
  }

  /**
   * Check whether instruments in the set are within the template's validated
   * research universe. Returns warnings (never errors).
   */
  checkUniverseWarnings(
    set: InstrumentSetRevision,
    template: ExperienceTemplateRevision,
  ): import("@electron/shared/domain/experience-inputs/validation-result").FieldWarning[] {
    const universe = template.researchContract.tradableUniverse;
    if (universe.length === 0) return [];

    const universeUpper = universe.map((s) => s.toUpperCase());
    return set.members
      .filter((m) => !universeUpper.includes(m.canonicalId.toUpperCase()))
      .map((m) => ({
        field: "instrumentSetId",
        code: "OUTSIDE_VALIDATED_UNIVERSE",
        message: `Instrument "${m.displaySymbol}" is outside the template's validated research universe.`,
      }));
  }
}
