import type { InstrumentClass, ProcessingMode, TradingTimeframe } from "@electron/shared/domain/enums";
import type { LiveSignalSourceType } from "@electron/shared/domain/signals";
import type { MarketSignalKind } from "@electron/shared/domain/market-signal";
import type { ExperiencePresetIds } from "@electron/shared/domain/signal-descriptor";
import type { BrokerRequirement } from "@electron/shared/domain/experience";
import type { ExperienceResearchContract } from "@electron/shared/domain/research-contract";
import type { CadenceSpec } from "./cadence";

// ---------------------------------------------------------------------------
// Experience template
// ---------------------------------------------------------------------------

export type TemplateStatus = "draft" | "active" | "retired";
export type InputMode = "event_source" | "scheduled_scan" | "manual";
export type UniversePolicy =
  | "validated_only"
  | "allow_unvalidated_with_warning";

export interface TemplateInputContract {
  modes: InputMode[];
  sourceKinds: LiveSignalSourceType[];
  signalKinds: MarketSignalKind[];
  instrumentClasses: InstrumentClass[];
  analysisTimeframes: TradingTimeframe[];
}

export interface ExperienceTemplateRevision {
  templateId: string;
  version: number;
  status: TemplateStatus;
  displayName: string;
  description: string;
  pipelineId: string;
  strategyId: string | null;
  promptVariantKey: ProcessingMode;
  brokerRequirement: BrokerRequirement;
  inputContract: TemplateInputContract;
  defaultPresetIds: ExperiencePresetIds;
  researchContract: ExperienceResearchContract;
  universePolicy: UniversePolicy;
}

export interface ExperienceTemplateSummary {
  templateId: string;
  latestVersion: number;
  activeVersion: number | null;
  displayName: string;
  description: string;
  inputModes: InputMode[];
  instrumentClasses: InstrumentClass[];
  status: TemplateStatus;
}

// ---------------------------------------------------------------------------
// Event source definition
// ---------------------------------------------------------------------------

export interface SourceDefinition {
  id: string;
  kind: LiveSignalSourceType;
  name: string;
  description: string | null;
  enabled: boolean;
  integrationId: string | null;
  outputContractId: string;
  configSchemaVersion: number;
  config: Record<string, unknown>;
  revision: number;
}

// ---------------------------------------------------------------------------
// Instrument set
// ---------------------------------------------------------------------------

export type InstrumentSetStatus = "draft" | "active" | "retired";
export type InstrumentSetMode = "static" | "source_driven";

export interface InstrumentSetMember {
  canonicalId: string;
  displaySymbol: string;
  venue: string | null;
}

export interface InstrumentSetRevision {
  setId: string;
  revision: number;
  status: InstrumentSetStatus;
  name: string;
  instrumentClass: InstrumentClass;
  mode: InstrumentSetMode;
  members: InstrumentSetMember[];
}

// ---------------------------------------------------------------------------
// Input profile (discriminated by mode)
// ---------------------------------------------------------------------------

export type ExperienceInputProfile =
  | {
      id: string;
      templateId: string;
      templateVersion: number;
      mode: "event_source";
      name: string;
      sourceDefinitionId: string;
      sourceRevision: number;
      filters: Record<string, unknown>;
      analysisTimeframe: TradingTimeframe;
      revision: number;
    }
  | {
      id: string;
      templateId: string;
      templateVersion: number;
      mode: "scheduled_scan";
      name: string;
      instrumentSetId: string;
      instrumentSetRevision: number;
      cadence: CadenceSpec;
      analysisTimeframe: TradingTimeframe;
      marketCalendarId: string;
      strategyParameters: Record<string, unknown>;
      revision: number;
    };

// ---------------------------------------------------------------------------
// Configuration options returned by the API
// ---------------------------------------------------------------------------

export interface CadenceConstraints {
  /** Minimum cadence in milliseconds determined by strategy and provider. */
  minimumMs: number;
  /** Suggested default cadence. */
  defaultCadence: CadenceSpec;
}

export interface TemplateConfigurationOptions {
  templateId: string;
  templateVersion: number;
  availableSourceDefinitions: SourceDefinition[];
  availableInstrumentSets: InstrumentSetRevision[];
  supportedAnalysisTimeframes: TradingTimeframe[];
  cadenceConstraints: CadenceConstraints | null;
  strategyParameterSchema: Record<string, unknown> | null;
  recommendedProfiles: ExperienceInputProfile[];
  brokerRequirement: BrokerRequirement;
  universePolicy: UniversePolicy;
  researchContract: ExperienceResearchContract;
}

// ---------------------------------------------------------------------------
// Session configuration draft / create shapes
// ---------------------------------------------------------------------------

export type SessionInputSubscriptionDraftItem =
  | {
      mode: "event_source";
      sourceDefinitionId: string;
      sourceRevision: number;
      filters: Record<string, unknown>;
      analysisTimeframe: TradingTimeframe;
    }
  | {
      mode: "scheduled_scan";
      instrumentSetId: string;
      instrumentSetRevision: number;
      cadence: CadenceSpec;
      analysisTimeframe: TradingTimeframe;
      marketCalendarId: string;
      strategyParameters: Record<string, unknown>;
    };

export interface SessionConfigurationDraft {
  templateId: string;
  templateVersion: number;
  subscriptions: SessionInputSubscriptionDraftItem[];
}

