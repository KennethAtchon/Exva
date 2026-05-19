import { useEffect, useState, type CSSProperties } from "react";
import { Card, SectionTitle, ShadcnSelect } from "@/components/custom-ui";
import { Switch } from "@/components/ui";
import { api } from "@/lib/exva";
import type { PhaseRuntimeSummary } from "@/lib/exva";
import type { ProviderAccount } from "@/lib/types";
import { PIPELINE_PHASES, type PipelinePhase } from "../../../electron/shared/ai/pipeline-phase";

const PHASE_LABELS: Record<PipelinePhase, string> = {
  selector: "Selector",
  technical: "Technical",
  fundamental: "Fundamental",
  review: "Review",
  decision: "Decision",
};

const fieldLabelStyle: CSSProperties = {
  fontSize: 11,
  color: "var(--text3)",
  marginBottom: 4,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text1)",
  fontSize: 13,
};

interface AiPhasesSectionProps {
  aiPhases: PhaseRuntimeSummary[];
  providers: ProviderAccount[];
  isLocked: boolean;
  onUpdatePhase: (phase: PipelinePhase, patch: Partial<PhaseRuntimeSummary>) => void;
}

export const AiPhasesSection = ({ aiPhases, providers, isLocked, onUpdatePhase }: AiPhasesSectionProps) => {
  const phaseMap = Object.fromEntries(aiPhases.map((p) => [p.phase, p])) as Partial<Record<PipelinePhase, PhaseRuntimeSummary>>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
  const [models, setModels] = useState<Array<{ id: string; label: string }>>([]);

  useEffect(() => {
    if (!config.providerKey) {
      setModels([]);
      return;
    }
    let cancelled = false;
    void api.getStrategyProviderModels(config.providerKey).then((result) => {
      if (!cancelled) {
        setModels(result.models.map((m) => ({ id: m.id, label: m.label || m.id })));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [config.providerKey]);

  const providerOptions = providers.map((p) => ({ value: p.id, label: p.name }));
  const modelOptions = models.map((m) => ({ value: m.id, label: m.label }));
  const useOverride = config.promptSource === "session_override";

  return (
    <Card>
      <SectionTitle>{PHASE_LABELS[phase]}</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 14 }}>
        <div>
          <div style={fieldLabelStyle}>Provider</div>
          <ShadcnSelect
            value={config.providerKey || ""}
            onValueChange={(providerKey) => onUpdate({ providerKey, modelId: "" })}
            options={providerOptions}
            placeholder="Select provider"
            disabled={isLocked}
          />
        </div>
        <div>
          <div style={fieldLabelStyle}>Model</div>
          <ShadcnSelect
            value={config.modelId || ""}
            onValueChange={(modelId) => onUpdate({ modelId })}
            options={modelOptions}
            placeholder={config.providerKey ? "Select model" : "Select provider first"}
            disabled={isLocked || !config.providerKey}
          />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <div style={fieldLabelStyle}>Temperature</div>
            <input
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={config.temperature}
              disabled={isLocked}
              style={inputStyle}
              onChange={(e) => onUpdate({ temperature: Number(e.target.value) })}
            />
          </div>
          <div>
            <div style={fieldLabelStyle}>Max tokens</div>
            <input
              type="number"
              min={256}
              step={256}
              value={config.maxTokens}
              disabled={isLocked}
              style={inputStyle}
              onChange={(e) => onUpdate({ maxTokens: Number(e.target.value) })}
            />
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 13, color: "var(--text1)" }}>Session prompt override</div>
            <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>
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
            style={{ ...inputStyle, resize: "vertical", fontFamily: "var(--font-mono)", fontSize: 12 }}
            onChange={(e) => onUpdate({ promptMarkdown: e.target.value })}
            placeholder="Phase-level prompt override (markdown)"
          />
        )}
        {config.workerOverrides.length > 0 && (
          <div style={{ fontSize: 11, color: "var(--text3)" }}>
            {config.workerOverrides.length} worker override{config.workerOverrides.length === 1 ? "" : "s"} configured
          </div>
        )}
      </div>
    </Card>
  );
};
