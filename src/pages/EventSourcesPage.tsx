import { useEffect, useState } from "react";
import { sourceDefinitionsApi } from "@/lib/experience-catalog-api";
import type { SourceDefinition } from "@electron/shared/domain/experience-inputs/catalog";
import { Card, PageShell } from "@/components/custom-ui";
import { Button, HelpTooltip, Switch } from "@/components/ui";
import { cn } from "@/lib/utils";

export function EventSourcesPage() {
  const [sources, setSources] = useState<SourceDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { sources: next } = await sourceDefinitionsApi.list();
      setSources(next);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load event source definitions.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <PageShell>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[12px] uppercase tracking-[0.14em] text-[var(--text3)]">
            CONFIGURATION
          </div>
          <h1 className="m-0 mt-2.5 text-[28px]">Event Sources</h1>
          <p className="mt-2 text-[13px] text-[var(--text3)]">
            Feed definitions that produce trading signals for event-driven
            strategies. Distinct from legacy integrations — these are the
            protocol-level source definitions used by input subscriptions.
          </p>
          <div className="mt-2 text-[12px] text-[var(--text3)]">
            <HelpTooltip
              topic="Event sources vs. integrations"
              body="Event sources define the output contract of an external signal feed. Integrations (in Accounts) manage credentials and connectivity. A single integration can back multiple event source definitions."
            />
          </div>
        </div>
      </div>

      <Card className="!p-0">
        {loading ? (
          <div className="grid gap-3 p-4">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-[88px] animate-pulse rounded-lg border border-[var(--border)] bg-[var(--surface2)]"
              />
            ))}
          </div>
        ) : error ? (
          <div className="m-4 rounded-lg border border-error-border bg-error-dim px-3 py-2 text-[13px] text-error">
            {error}{" "}
            <button
              className="underline"
              onClick={() => void load()}
              type="button"
            >
              Retry
            </button>
          </div>
        ) : sources.length === 0 ? (
          <div className="m-4 rounded-lg border border-dashed border-[var(--border)] p-6 text-[13px] text-[var(--text3)]">
            <div className="mb-2 font-medium text-[var(--text1)]">
              No event source definitions found
            </div>
            <p className="m-0 leading-relaxed">
              Event source definitions are registered by the backend when an
              integration is configured. Connect an integration in{" "}
              <strong>Accounts</strong> to provision source definitions here.
            </p>
          </div>
        ) : (
          sources.map((source) => (
            <SourceRow
              key={source.id}
              source={source}
              onChanged={() => void load()}
            />
          ))
        )}
      </Card>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface2)] px-4 py-3 text-[12px] text-[var(--text3)]">
        <strong className="font-semibold text-[var(--text2)]">
          Looking for legacy signal sources?
        </strong>{" "}
        Timer-based schedules and raw EDGAR/mock sources live in{" "}
        <strong>Signals</strong> in the nav bar. This page shows only
        event-source definitions used by V2 input subscriptions.
      </div>
    </PageShell>
  );
}

// ---------------------------------------------------------------------------
// Source row
// ---------------------------------------------------------------------------

function SourceRow({
  source,
  onChanged,
}: {
  source: SourceDefinition;
  onChanged: () => void;
}) {
  const [pending, setPending] = useState(false);

  const toggleEnabled = async (next: boolean) => {
    setPending(true);
    try {
      // Backend channel for toggle is not yet wired — optimistic UI only
      void next;
      void onChanged;
      window.alert("Enable/disable for V2 sources is not yet implemented.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex items-start gap-4 border-b border-[var(--border)] p-4 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-[var(--text1)]">
            {source.name}
          </span>
          <span className={kindChipClass(source.kind)}>
            {formatKind(source.kind)}
          </span>
          <span className="rounded-full border border-[var(--border)] px-2 py-[2px] text-[11px] text-[var(--text3)]">
            Rev {source.revision}
          </span>
          <span
            className={cn(
              "rounded-full border px-2 py-[2px] text-[11px]",
              source.enabled
                ? "border-success-border bg-success-dim text-success"
                : "border-[var(--border)] text-[var(--text3)]",
            )}
          >
            {source.enabled ? "Enabled" : "Disabled"}
          </span>
        </div>

        {source.description ? (
          <div className="mt-1 text-[12px] text-[var(--text3)]">
            {source.description}
          </div>
        ) : null}

        <div className="mt-1 text-[12px] text-[var(--text3)]">
          Output contract: {source.outputContractId}
          {source.integrationId ? ` · Integration: ${source.integrationId}` : null}
        </div>

        <ConfigSummary source={source} />
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <HelpTooltip
          topic="Enable source"
          body="Disabling prevents new subscriptions from receiving events from this source. Existing subscriptions stay in place but will wait until the source is re-enabled."
        >
          <Switch
            checked={source.enabled}
            disabled={pending}
            onCheckedChange={(v) => void toggleEnabled(v)}
          />
        </HelpTooltip>
        <Button
          variant="outline"
          className="h-8 text-xs"
          disabled={pending}
          onClick={() => {
            const json = JSON.stringify(source.config, null, 2);
            window.alert(`Source config (read-only):\n\n${json}`);
          }}
        >
          View config
        </Button>
      </div>
    </div>
  );
}

function ConfigSummary({ source }: { source: SourceDefinition }) {
  const keys = Object.keys(source.config);
  if (keys.length === 0) return null;
  const preview = keys
    .slice(0, 3)
    .map((k) => `${k}: ${String(source.config[k]).slice(0, 24)}`)
    .join(" · ");
  return (
    <div className="mt-1 text-[12px] text-[var(--text3)]">
      Config: {preview}
      {keys.length > 3 ? ` +${keys.length - 3} more` : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatKind(kind: string): string {
  if (kind === "edgar_8k") return "EDGAR 8-K";
  if (kind === "prediction_event") return "Prediction Event";
  if (kind === "mock") return "Mock";
  return kind;
}

function kindChipClass(kind: string): string {
  const base = "rounded-full border px-2 py-[2px] text-[11px] font-medium";
  if (kind === "edgar_8k")
    return `${base} border-info-border bg-info-dim text-info`;
  if (kind === "prediction_event")
    return `${base} border-market-border bg-market-dim text-market`;
  return `${base} border-[var(--border)] text-[var(--text2)]`;
}
