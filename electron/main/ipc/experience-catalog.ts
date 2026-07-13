import { ipcMain } from "electron";
import { channels } from "@electron/shared/ipc/channels";
import { handle } from "./handle";
import type { AppServices } from "../services/app-services";
import type { SessionInputSubscriptionDraft } from "@electron/shared/domain/experience-inputs/subscription";
import { SessionInputRuntimePlanner } from "../services/scheduling/session-input-runtime-planner";
import { getStrategyDefinitionRegistry } from "../services/strategies/index";
import type {
  InstrumentSetMode,
  InstrumentSetStatus,
} from "@electron/shared/domain/experience-inputs/catalog";
import type { InstrumentClass } from "@electron/shared/domain/enums";

export function registerExperienceCatalogHandlers(services: AppServices): void {
  // ------------------------------------------------------------------
  // Experience catalog: templates
  // ------------------------------------------------------------------

  handle(ipcMain, channels.experienceCatalog.templates.list, async () => {
    return { templates: services.experienceTemplateService.listTemplates() };
  });

  handle(
    ipcMain,
    channels.experienceCatalog.configurationOptions,
    async (payload) => {
      const { templateId, templateVersion } = payload as {
        templateId: string;
        templateVersion: number;
      };
      return services.sessionInputConfiguration.getConfigurationOptions(
        templateId,
        templateVersion,
      );
    },
  );

  handle(ipcMain, channels.experienceCatalog.validateDraft, async (payload) => {
    const { templateId, templateVersion, subscriptions } = payload as {
      templateId: string;
      templateVersion: number;
      subscriptions: SessionInputSubscriptionDraft[];
    };
    return services.sessionInputConfiguration.validateDraft({
      templateId,
      templateVersion,
      subscriptions,
    });
  });

  // ------------------------------------------------------------------
  // Instrument sets
  // ------------------------------------------------------------------

  handle(ipcMain, channels.instrumentSets.list, async () => {
    return { sets: services.instrumentSetService.list() };
  });

  handle(ipcMain, channels.instrumentSets.get, async (payload) => {
    const { setId, revision } = payload as { setId: string; revision?: number };
    const result =
      revision != null
        ? services.instrumentSetService.getRevision(setId, revision)
        : services.instrumentSetService.getActive(setId);
    return { set: result };
  });

  handle(ipcMain, channels.instrumentSets.createRevision, async (payload) => {
    const input = payload as {
      setId: string;
      name: string;
      instrumentClass: InstrumentClass;
      mode: InstrumentSetMode;
      status: InstrumentSetStatus;
      members: Array<{
        canonicalId: string;
        displaySymbol: string;
        venue?: string | null;
      }>;
    };
    const revision = services.instrumentSetService.createRevision(input);
    return { revision };
  });

  // ------------------------------------------------------------------
  // Source definitions
  // ------------------------------------------------------------------

  handle(ipcMain, channels.sourceDefinitions.list, async () => {
    return { definitions: services.sourceDefinitionService.list() };
  });

  handle(ipcMain, channels.sourceDefinitions.get, async (payload) => {
    const { id } = payload as { id: string };
    return { definition: services.sourceDefinitionService.get(id) };
  });

  // ------------------------------------------------------------------
  // Session inputs
  // ------------------------------------------------------------------

  handle(ipcMain, channels.sessionInputs.get, async (payload) => {
    const { sessionId } = payload as { sessionId: string };
    return {
      configuration:
        services.sessionInputConfiguration.getConfiguration(sessionId),
    };
  });

  handle(ipcMain, channels.sessionInputs.replace, async (payload) => {
    const {
      sessionId,
      templateId,
      templateVersion,
      subscriptions,
      expectedRevision,
    } = payload as {
      sessionId: string;
      templateId: string;
      templateVersion: number;
      subscriptions: SessionInputSubscriptionDraft[];
      expectedRevision: number;
    };
    const configuration = services.sessionInputConfiguration.replaceInputs(
      sessionId,
      {
        templateId,
        templateVersion,
        subscriptions,
        expectedRevision,
      },
    );
    const planner = new SessionInputRuntimePlanner({
      db: services.db,
      strategyRegistry: getStrategyDefinitionRegistry(),
    });
    services.scheduleCoordinator.reconcile(planner.buildPlans());
    return { configuration };
  });
}
