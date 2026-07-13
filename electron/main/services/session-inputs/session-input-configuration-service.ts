import type { DbClient } from "../../db/client";
import type {
  SessionInputConfiguration,
  SessionInputSubscriptionDraft,
} from "@electron/shared/domain/experience-inputs/subscription";
import type {
  ExperienceInputProfile,
  TemplateConfigurationOptions,
} from "@electron/shared/domain/experience-inputs/catalog";
import type { SessionDraftValidation } from "@electron/shared/domain/experience-inputs/validation-result";
import { SessionInputSubscriptionRepo } from "./session-input-subscription-repo";
import { ExperienceTemplateRepo } from "../experience-catalog/experience-template-repo";
import { InputProfileRepo } from "../experience-catalog/input-profile-repo";
import { InstrumentSetRepo } from "../instruments/instrument-set-repo";
import { SourceDefinitionRepo } from "../signals/source-definition-repo";
import { SubscriptionValidator } from "./subscription-validator";
import { CatalogValidator } from "../experience-catalog/catalog-validator";
import type { StrategyDefinitionRegistry } from "../strategies/strategy-definition-registry";
import type { SourceAdapterRegistry } from "../signals/adapters/source-adapter-registry";
import { parseCadence } from "@electron/shared/domain/experience-inputs/cadence";

export class SessionInputConfigurationService {
  private readonly subscriptionRepo: SessionInputSubscriptionRepo;
  private readonly templateRepo: ExperienceTemplateRepo;
  private readonly profileRepo: InputProfileRepo;
  private readonly setRepo: InstrumentSetRepo;
  private readonly sourceRepo: SourceDefinitionRepo;
  private readonly validator: SubscriptionValidator;
  private readonly catalogValidator: CatalogValidator;

  constructor(
    db: DbClient,
    strategyRegistry: StrategyDefinitionRegistry,
    adapterRegistry: SourceAdapterRegistry,
  ) {
    this.subscriptionRepo = new SessionInputSubscriptionRepo(db);
    this.templateRepo = new ExperienceTemplateRepo(db);
    this.profileRepo = new InputProfileRepo(db);
    this.setRepo = new InstrumentSetRepo(db);
    this.sourceRepo = new SourceDefinitionRepo(db);
    this.catalogValidator = new CatalogValidator(strategyRegistry, adapterRegistry);
    this.validator = new SubscriptionValidator(
      this.templateRepo,
      this.sourceRepo,
      this.setRepo,
      this.catalogValidator,
    );
  }

  /** Return the full resolved configuration for a session. */
  getConfiguration(sessionId: string): SessionInputConfiguration {
    return this.subscriptionRepo.getConfiguration(sessionId);
  }

  /** Return recommended profiles and available options for a template. */
  getConfigurationOptions(
    templateId: string,
    templateVersion: number,
  ): TemplateConfigurationOptions {
    const template = this.templateRepo.getRevision(templateId, templateVersion);
    if (!template) {
      throw new Error(
        `SessionInputConfigurationService: template "${templateId}" v${templateVersion} not found`,
      );
    }

    const availableSourceDefinitions =
      template.inputContract.sourceKinds.length > 0
        ? template.inputContract.sourceKinds.flatMap((kind) =>
            this.sourceRepo.listByKind(kind),
          )
        : [];

    const availableInstrumentSets = this.setRepo
      .list()
      .filter((s) =>
        template.inputContract.instrumentClasses.includes(s.instrumentClass),
      );

    const recommendedProfiles = this.profileRepo
      .listByTemplate(templateId, templateVersion)
      .slice(0, 5);

    return {
      templateId,
      templateVersion,
      availableSourceDefinitions,
      availableInstrumentSets,
      supportedAnalysisTimeframes: template.inputContract.analysisTimeframes,
      cadenceConstraints:
        template.inputContract.modes.includes("scheduled_scan")
          ? {
              minimumMs: 5 * 60 * 1_000,
              defaultCadence: {
                kind: "interval",
                every: 15,
                unit: "minute",
                jitterPct: 0.05,
              },
            }
          : null,
      strategyParameterSchema:
        template.strategyId != null ? { strategyId: template.strategyId } : null,
      recommendedProfiles,
      brokerRequirement: template.brokerRequirement,
      universePolicy: template.universePolicy,
      researchContract: template.researchContract,
    };
  }

  /** Validate a session draft without persisting. */
  validateDraft(input: {
    templateId: string;
    templateVersion: number;
    subscriptions: SessionInputSubscriptionDraft[];
  }): SessionDraftValidation {
    return this.validator.validateSessionDraft(input);
  }

  /**
   * Atomically replace all subscriptions for a session.
   * Validates the draft first — throws if invalid.
   * Uses optimistic concurrency; throws on revision conflict.
   */
  replaceInputs(
    sessionId: string,
    input: {
      templateId: string;
      templateVersion: number;
      subscriptions: SessionInputSubscriptionDraft[];
      expectedRevision: number;
    },
  ): SessionInputConfiguration {
    const validation = this.validator.validateSessionDraft(input);
    if (!validation.overall.valid) {
      const messages = validation.overall.errors.map((e) => e.message).join("; ");
      throw new Error(`Subscription draft is invalid: ${messages}`);
    }

    return this.subscriptionRepo.replaceSessionSubscriptions(
      sessionId,
      input.subscriptions,
      input.expectedRevision,
    );
  }

  /**
   * Create subscriptions from a saved input profile.
   * The profile must exist and match the given session template.
   */
  createFromProfile(
    sessionId: string,
    profileId: string,
    expectedRevision: number,
  ): SessionInputConfiguration {
    const profile = this.profileRepo.get(profileId);
    if (!profile) {
      throw new Error(
        `SessionInputConfigurationService: input profile "${profileId}" not found`,
      );
    }

    const draft = profileToDraft(profile);
    return this.replaceInputs(sessionId, {
      templateId: profile.templateId,
      templateVersion: profile.templateVersion,
      subscriptions: [draft],
      expectedRevision,
    });
  }

  getProfile(profileId: string): ExperienceInputProfile | null {
    return this.profileRepo.get(profileId);
  }

  listProfilesForTemplate(
    templateId: string,
    templateVersion?: number,
  ): ExperienceInputProfile[] {
    return this.profileRepo.listByTemplate(templateId, templateVersion);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function profileToDraft(
  profile: ExperienceInputProfile,
): SessionInputSubscriptionDraft {
  if (profile.mode === "event_source") {
    return {
      mode: "event_source",
      templateId: profile.templateId,
      templateVersion: profile.templateVersion,
      sourceDefinitionId: profile.sourceDefinitionId,
      sourceRevision: profile.sourceRevision,
      filters: profile.filters,
      analysisTimeframe: profile.analysisTimeframe,
      createdFromProfileId: profile.id,
    };
  }
  return {
    mode: "scheduled_scan",
    templateId: profile.templateId,
    templateVersion: profile.templateVersion,
    instrumentSetId: profile.instrumentSetId,
    instrumentSetRevision: profile.instrumentSetRevision,
    cadence: typeof profile.cadence === "string"
      ? parseCadence(JSON.parse(profile.cadence))
      : profile.cadence,
    analysisTimeframe: profile.analysisTimeframe,
    marketCalendarId: profile.marketCalendarId,
    strategyParameters: profile.strategyParameters,
    createdFromProfileId: profile.id,
  };
}
