import { useEffect, useState } from "react";
import { sourceDefinitionsApi } from "@/lib/experience-catalog-api";
import type { SourceDefinition } from "@electron/shared/domain/experience-inputs/catalog";
import { Card } from "@/components/custom-ui";
import { Button, HelpTooltip, Switch } from "@/components/ui";
import { cn } from "@/lib/utils";

export function EventSourcesPage({
  embedded = false,
}: {
  embedded?: boolean;
} = {}) {
  const [sources, setSources] = useState<SourceDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async (opts?: { soft?: boolean }) => {
    if (!opts?.soft) setLoading(true);
    setError(null);
    try {
      const { sources: next } = await sourceDefinitionsApi.list();
      setSources(next ?? []);
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
    <div
      className={
        embedded ? "flex flex-col gap-3" : "hub-panel-body flex flex-col gap-5"
      }
    >
      {!embedded ? (
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[12px] uppercase tracking-[0.14em] text-[var(--text3)]">
              CONFIGURATION
            </div>
            <h1 className="m-0 mt-2.5 text-[28px]">Event Sources</h1>
            <p className="mt-2 text-[13px] text-[var(--text3)]">
              Catalog definitions used by session input subscriptions (V2).
              Toggle disables fanout for that definition.
            </p>
            <div className="mt-2 text-[12px] text-[var(--text3)]">
              <HelpTooltip
                topic="Event sources vs. integrations"
                body="Event sources define the output contract of an external signal feed. Integrations (in Settings → Accounts) manage credentials. A single integration can back multiple event source definitions."
              />
            </div>
          </div>
        </div>
      ) : null}

      <Card className="!p-0">
        {loading && sources.length === 0 ? (
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
              Built-in definitions seed on first boot. If this stays empty,
              check Settings → Developer for catalog seed errors.
            </p>
          </div>
        ) : (
          sources.map((source) => (
            <SourceRow
              key={source.id}
              source={source}
              onChanged={() => void load({ soft: true })}
            />
          ))
        )}
      </Card>

      {!embedded ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface2)] px-4 py-3 text-[12px] text-[var(--text3)]">
          <strong className="font-semibold text-[var(--text2)]">
            Looking for live EDGAR / mock pollers?
          </strong>{" "}
          Those runtime sources sit in the left pane under{" "}
          <strong>Signal feeds</strong> on this hub.
        </div>
      ) : null}
    </div>
  );
}

function SourceRow({
  source,
  onChanged,
}: {
  source: SourceDefinition;
  onChanged: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  const toggleEnabled = async (next: boolean) => {
    setPending(true);
    setRowError(null);
    try {
      await sourceDefinitionsApi.setEnabled({ id: source.id, enabled: next });
      onChanged();
    } catch (err) {
      setRowError(
        err instanceof Error ? err.message : "Failed to update source.",
      );
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
          {source.integrationId
            ? ` · Integration: ${source.integrationId}`
            : null}
        </div>

        {rowError ? (
          <div className="mt-1 text-[12px] text-error">{rowError}</div>
        ) : null}

        <ConfigSummary source={source} />
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <HelpTooltip
          topic="Enable source"
          body="Disabling stops fanout for this definition. Existing subscriptions stay, but new signals will not deliver until re-enabled."
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
          disabled
          title="Config editing lands with input-catalog editors"
        >
          Configure
        </Button>
      </div>
    </div>
  );
}

function ConfigSummary({ source }: { source: SourceDefinition }) {
  const keys = Object.keys(source.config ?? {});
  if (keys.length === 0) {
    return (
      <div className="mt-1 text-[12px] text-[var(--text3)]">
        No config overrides
      </div>
    );
  }
  return (
    <div className="mt-1 text-[12px] text-[var(--text3)]">
      Config keys: {keys.slice(0, 6).join(", ")}
      {keys.length > 6 ? ` (+${keys.length - 6})` : ""}
    </div>
  );
}

function formatKind(kind: string): string {
  return kind.replace(/_/g, " ");
}

function kindChipClass(kind: string): string {
  void kind;
  return "rounded-full border border-[var(--border)] bg-[var(--surface2)] px-2 py-[2px] text-[11px] capitalize text-[var(--text2)]";
}
