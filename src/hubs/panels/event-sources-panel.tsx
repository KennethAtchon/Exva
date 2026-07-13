import { useEffect, useState } from "react";
import { sourceDefinitionsApi } from "@/lib/experience-catalog-api";
import type { SourceDefinition } from "@electron/shared/domain/experience-inputs/catalog";
import { Badge } from "@/components/custom-ui";
import { Button, HelpTooltip, Switch } from "@/components/ui";
import { EmptyState } from "@/components/ui/primitives";
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
    <div className={embedded ? "flex flex-col gap-3" : "flex flex-col gap-5"}>
      {!embedded ? (
        <div>
          <div className="font-mono text-micro uppercase tracking-wider text-text3">
            Configuration
          </div>
          <h1 className="m-0 mt-2 font-sans text-title text-text1">
            Event Sources
          </h1>
          <p className="mt-2 font-sans text-body text-text3">
            Catalog definitions used by session input subscriptions. Toggle
            disables fanout for that definition.
          </p>
          <div className="mt-2">
            <HelpTooltip
              topic="Event sources vs. integrations"
              body="Event sources define the output contract of an external signal feed. Integrations manage credentials in Settings."
            />
          </div>
        </div>
      ) : null}

      {loading && sources.length === 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-32 animate-pulse rounded-sm border border-border bg-surface2"
            />
          ))}
        </div>
      ) : error ? (
        <EmptyState
          message={error}
          actionLabel="Retry"
          onAction={() => void load()}
        />
      ) : sources.length === 0 ? (
        <EmptyState message="No event source definitions found. Built-in definitions seed on first boot." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sources.map((source) => (
            <EventSourceCard
              key={source.id}
              source={source}
              onChanged={() => void load({ soft: true })}
            />
          ))}
        </div>
      )}

      {!embedded ? (
        <div className="rounded-sm border border-border bg-surface2 px-4 py-3 font-sans text-caption text-text3">
          Live EDGAR and mock pollers sit under{" "}
          <span className="text-text2">Signal sources</span> on this hub.
        </div>
      ) : null}
    </div>
  );
}

function EventSourceCard({
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
    <article className="flex flex-col rounded-sm border border-border bg-surface p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "inline-block h-2 w-2 shrink-0 rounded-full",
              source.enabled ? "bg-success" : "bg-text3",
            )}
          />
          <h3 className="m-0 truncate font-sans text-label text-text1">
            {source.name}
          </h3>
        </div>
        <Badge variant="default" size="sm">
          {formatKind(source.kind)}
        </Badge>
      </div>

      <div className="mb-3 space-y-1 font-mono text-caption text-text3">
        <div>Rev {source.revision}</div>
        {source.description ? (
          <div className="line-clamp-2">{source.description}</div>
        ) : null}
        <div className="truncate">Contract · {source.outputContractId}</div>
        {rowError ? <div className="text-error">{rowError}</div> : null}
      </div>

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-hairline pt-3">
        <HelpTooltip
          topic="Enable source"
          body="Disabling stops fanout for this definition until re-enabled."
        >
          <Switch
            checked={source.enabled}
            disabled={pending}
            onCheckedChange={(v) => void toggleEnabled(v)}
          />
        </HelpTooltip>
        <Button
          variant="ghost"
          size="sm"
          disabled
          title="Config editing lands with input-catalog editors"
        >
          Configure
        </Button>
      </div>
    </article>
  );
}

function formatKind(kind: string): string {
  return kind.replace(/_/g, " ");
}
