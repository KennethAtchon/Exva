import { useEffect, useState } from "react";
import { Card, SectionTitle, ShadcnSelect } from "@/components/custom-ui";
import { Switch } from "@/components/ui";
import { api } from "@/lib/exva";
import type { PhaseRuntimeSummary } from "@/lib/exva";
import type { ProviderAccount } from "@/lib/types";
import {
  PIPELINE_PHASES,
  REASONING_LEVEL_OPTIONS,
  type PipelinePhase,
} from "../../../electron/shared/ai/ai-phase";

const PHASE_LABELS: Record<PipelinePhase, string> = {
  selector: "Selector",
  technical: "Technical",
  fundamental: "Fundamental",
  review: "Review",
  decision: "Decision",
};

const fieldLabelClass =
  "mb-1 text-[12px] uppercase tracking-[0.04em] text-[var(--text3)]";

const inputClass =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-2 text-[13px] text-[var(--text1)]";

interface AiPhasesSectionProps {
  aiPhases: PhaseRuntimeSummary[];
  providers: ProviderAccount[];
  isLocked: boolean;
  onUpdatePhase: (
    phase: PipelinePhase,
    patch: Partial<PhaseRuntimeSummary>,
  ) => void;
}

export const AiPhasesSection = ({
  aiPhases,
  providers,
  isLocked,
  onUpdatePhase,
}: AiPhasesSectionProps) => {
  const phaseMap = Object.fromEntries(
    aiPhases.map((p) => [p.phase, p]),
  ) as Partial<Record<PipelinePhase, PhaseRuntimeSummary>>;

  return (
    <div className="flex flex-col gap-4">
      {PIPELINE_PHASES.map((phase) => {
        const config = phaseMap[phase];
        if (!config) return null;
        return (
          <PhaseCard
            key={phase}
            phase={phase}
            config={config}
            providers={providers}
            isLocked={isLocked}
            onUpdate={(patch) => onUpdatePhase(phase, patch)}
          />
        );
      })}
    </div>
  );
};

const PhaseCard = ({
  phase,
  config,
  providers,
  isLocked,
  onUpdate,
}: {
  phase: PipelinePhase;
  config: PhaseRuntimeSummary;
  providers: ProviderAccount[];
  isLocked: boolean;
  onUpdate: (patch: Partial<PhaseRuntimeSummary>) => void;
}) => {
  const [models, setModels] = useState<Array<{ id: string; label: string }>>(
    [],
  );

  useEffect(() => {
    if (!config.providerKey) {
      setModels([]);
      return;
    }
    let cancelled = false;
    void api.getStrategyProviderModels(config.providerKey).then((result) => {
      if (!cancelled) {
        setModels(
          result.models.map((m) => ({ id: m.id, label: m.label || m.id })),
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [config.providerKey]);

  const providerOptions = providers.map((p) => ({
    value: p.id,
    label: p.name,
  }));
  const modelOptions = models.map((m) => ({ value: m.id, label: m.label }));
  const useOverride = config.promptSource === "session_override";

  return (
    <Card>
      <SectionTitle>{PHASE_LABELS[phase]}</SectionTitle>
      <div className="mt-3.5 flex flex-col gap-3">
        <div>
          <div className={fieldLabelClass}>Provider</div>
          <ShadcnSelect
            value={config.providerKey || ""}
            onValueChange={(providerKey) =>
              onUpdate({ providerKey, modelId: "" })
            }
            options={providerOptions}
            placeholder="Select provider"
            disabled={isLocked}
          />
        </div>
        <div>
          <div className={fieldLabelClass}>Model</div>
          <ShadcnSelect
            value={config.modelId || ""}
            onValueChange={(modelId) => onUpdate({ modelId })}
            options={modelOptions}
            placeholder={
              config.providerKey ? "Select model" : "Select provider first"
            }
            disabled={isLocked || !config.providerKey}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className={fieldLabelClass}>Temperature</div>
            <input
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={config.temperature}
              disabled={isLocked}
              className={inputClass}
              onChange={(e) =>
                onUpdate({ temperature: Number(e.target.value) })
              }
            />
          </div>
          <div>
            <div className={fieldLabelClass}>Max tokens</div>
            <input
              type="number"
              min={256}
              step={256}
              value={config.maxTokens}
              disabled={isLocked}
              className={inputClass}
              onChange={(e) => onUpdate({ maxTokens: Number(e.target.value) })}
            />
          </div>
        </div>
        <div>
          <div className={fieldLabelClass}>Reasoning</div>
          <ShadcnSelect
            value={config.reasoningLevel ?? "off"}
            onValueChange={(reasoningLevel) =>
              onUpdate({
                reasoningLevel:
                  reasoningLevel as PhaseRuntimeSummary["reasoningLevel"],
              })
            }
            options={[...REASONING_LEVEL_OPTIONS]}
            placeholder="Off"
            disabled={isLocked}
          />
          <div className="mt-1 text-[12px] text-[var(--text3)]">
            Non-off levels increase token spend. Pair with a reasoning-capable
            model.
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[13px] text-[var(--text1)]">
              Session prompt override
            </div>
            <div className="mt-0.5 text-[12px] text-[var(--text3)]">
              Replace the bundled worker prompt for this phase.
            </div>
          </div>
          <Switch
            checked={useOverride}
            disabled={isLocked}
            onCheckedChange={(checked) =>
              onUpdate({
                promptSource: checked ? "session_override" : "default",
                promptMarkdown: checked ? config.promptMarkdown : "",
              })
            }
          />
        </div>
        {useOverride && (
          <textarea
            value={config.promptMarkdown}
            disabled={isLocked}
            rows={6}
            className={`${inputClass} resize-y font-mono text-[12px]`}
            onChange={(e) => onUpdate({ promptMarkdown: e.target.value })}
            placeholder="Phase-level prompt override (markdown)"
          />
        )}
        {config.workerOverrides.length > 0 && (
          <div className="text-[12px] text-[var(--text3)]">
            {config.workerOverrides.length} worker override
            {config.workerOverrides.length === 1 ? "" : "s"} configured
          </div>
        )}
      </div>
    </Card>
  );
};
