import type {
  ExperienceTemplateSummary,
  InstrumentSetRevision,
  SessionConfigurationDraft,
  SourceDefinition,
  TemplateConfigurationOptions,
} from "@electron/shared/domain/experience-inputs/catalog";
import type { SessionDraftValidation } from "@electron/shared/domain/experience-inputs/validation-result";
import type {
  SessionInputConfiguration,
  SessionInputSubscriptionDraft,
} from "@electron/shared/domain/experience-inputs/subscription";
import type { InstrumentClass } from "@electron/shared/domain/enums";

function bridge() {
  if (
    typeof window === "undefined" ||
    typeof window.exva !== "object" ||
    !window.exva
  ) {
    throw new Error(
      "EXVA bridge unavailable. Run `bun run dev` / `bun run start` (Electron host).",
    );
  }
  return window.exva;
}

export const experienceCatalogApi = {
  listTemplates(): Promise<{ templates: ExperienceTemplateSummary[] }> {
    return bridge().experienceCatalog.listTemplates() as Promise<{
      templates: ExperienceTemplateSummary[];
    }>;
  },

  getConfigurationOptions(input: {
    templateId: string;
    templateVersion?: number;
  }): Promise<TemplateConfigurationOptions> {
    return bridge().experienceCatalog.getConfigurationOptions(
      input,
    ) as Promise<TemplateConfigurationOptions>;
  },

  validateDraft(
    input: SessionConfigurationDraft,
  ): Promise<SessionDraftValidation> {
    return bridge().experienceCatalog.validateDraft(
      input,
    ) as Promise<SessionDraftValidation>;
  },
};

export const instrumentSetsApi = {
  list(): Promise<{ sets: InstrumentSetRevision[] }> {
    return bridge().instrumentSets.list() as Promise<{
      sets: InstrumentSetRevision[];
    }>;
  },

  get(input: { setId: string }): Promise<{ set: InstrumentSetRevision }> {
    return bridge().instrumentSets.get(input) as Promise<{
      set: InstrumentSetRevision;
    }>;
  },

  createRevision(input: {
    setId?: string;
    name: string;
    instrumentClass: InstrumentClass;
    members: Array<{
      canonicalId: string;
      displaySymbol: string;
      venue?: string | null;
    }>;
  }): Promise<{ set: InstrumentSetRevision }> {
    return bridge().instrumentSets.createRevision(input) as Promise<{
      set: InstrumentSetRevision;
    }>;
  },
};

export const sourceDefinitionsApi = {
  list(): Promise<{ sources: SourceDefinition[] }> {
    return bridge().sourceDefinitions.list() as Promise<{
      sources: SourceDefinition[];
    }>;
  },

  get(input: { id: string }): Promise<{ source: SourceDefinition | null }> {
    return bridge().sourceDefinitions.get(input) as Promise<{
      source: SourceDefinition | null;
    }>;
  },

  setEnabled(input: {
    id: string;
    enabled: boolean;
  }): Promise<{ source: SourceDefinition }> {
    return bridge().sourceDefinitions.setEnabled(input) as Promise<{
      source: SourceDefinition;
    }>;
  },
};

export const sessionInputsApi = {
  get(input: { sessionId: string }): Promise<SessionInputConfiguration> {
    return bridge().sessionInputs.get(
      input,
    ) as Promise<SessionInputConfiguration>;
  },

  replace(input: {
    sessionId: string;
    inputRevision: number;
    subscriptions: SessionInputSubscriptionDraft[];
  }): Promise<SessionInputConfiguration> {
    return bridge().sessionInputs.replace(
      input,
    ) as Promise<SessionInputConfiguration>;
  },
};
