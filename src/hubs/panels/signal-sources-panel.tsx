import { useEffect, useState, type ReactNode } from "react";
import { Badge } from "@/components/custom-ui";
import {
  Button,
  Dialog,
  DialogContent,
  HelpTooltip,
  Switch,
} from "@/components/ui";
import { confirm } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/primitives";
import { PanelLoading } from "@/components/ui/skeleton";
import { api } from "@/lib/exva";
import { formatRelative } from "@/lib/format";
import { formatSignalSourceTimingSubtitle } from "@electron/shared/domain/signal-timing";
import { useExvaEvent } from "@/hooks/useExvaEvent";
import type { HelpGlossaryId } from "@/lib/help-glossary";
import { cn } from "@/lib/utils";

type Source = Awaited<
  ReturnType<typeof api.listSignalSources>
>["sources"][number];

type ConfigureState = {
  source: Source;
  name: string;
  description: string;
  pollIntervalMarketMinutes: string;
  pollIntervalOffHoursMinutes: string;
  cikWhitelist: string;
  minFilingAgeMinutes: string;
};

export function SignalSourcesPage({
  embedded = false,
  hideHeader = false,
  addOpenExternal,
  onAddOpenChange,
}: {
  embedded?: boolean;
  hideHeader?: boolean;
  addOpenExternal?: boolean;
  onAddOpenChange?: (open: boolean) => void;
} = {}) {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpenInternal, setAddOpenInternal] = useState(false);
  const [configure, setConfigure] = useState<ConfigureState | null>(null);

  const addControlled = onAddOpenChange != null;
  const addOpen = addControlled ? Boolean(addOpenExternal) : addOpenInternal;
  const setAddOpen = (open: boolean) => {
    if (onAddOpenChange) onAddOpenChange(open);
    else setAddOpenInternal(open);
  };

  const load = async (opts?: { soft?: boolean }) => {
    if (!opts?.soft) setLoading(true);
    setError(null);
    try {
      const next = await api.listSignalSources();
      setSources(next.sources.filter((source) => source.type !== "manual"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sources.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useExvaEvent("signal_received", () => void load({ soft: true }));
  useExvaEvent("signal_delivery_updated", () => void load({ soft: true }));

  const showHeader = !embedded && !hideHeader;

  return (
    <div className={embedded ? "flex flex-col gap-3" : "flex flex-col gap-5"}>
      {showHeader ? (
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-mono text-micro uppercase tracking-wider text-text3">
              Sources
            </div>
            <h1 className="m-0 mt-2 font-sans text-title text-text1">
              Signal Sources
            </h1>
            <p className="mt-2 font-sans text-body text-text3">
              Connect real-time data feeds to drive the trading pipeline.
            </p>
            <div className="mt-2">
              <HelpTooltip
                glossaryId="signal-source"
                body="Sources are global. Sessions subscribe to one active source at a time."
              />
            </div>
          </div>
          <Button onClick={() => setAddOpen(true)}>Add source</Button>
        </div>
      ) : null}

      {embedded && !addControlled ? (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setAddOpen(true)}>
            Add source
          </Button>
        </div>
      ) : null}

      {loading && sources.length === 0 ? (
        <PanelLoading rows={4} />
      ) : error ? (
        <EmptyState
          message={`Failed to load signal sources. ${error}`}
          actionLabel="Retry"
          onAction={() => void load()}
        />
      ) : sources.length === 0 ? (
        <EmptyState
          message="No signal sources configured. Create one here, then subscribe sessions when you create or edit a session."
          actionLabel="Add source"
          onAction={() => setAddOpen(true)}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sources.map((source) => (
            <SourceCard
              key={source.id}
              source={source}
              onChanged={() => void load({ soft: true })}
              onConfigure={() =>
                setConfigure({
                  source,
                  name: source.name,
                  description: source.description ?? "",
                  pollIntervalMarketMinutes: String(
                    Number(
                      readConfig(source, "pollIntervalMarketMinutes") ?? 3,
                    ),
                  ),
                  pollIntervalOffHoursMinutes: String(
                    Number(
                      readConfig(source, "pollIntervalOffHoursMinutes") ?? 15,
                    ),
                  ),
                  cikWhitelist: Array.isArray(
                    readConfig(source, "cikWhitelist"),
                  )
                    ? (readConfig(source, "cikWhitelist") as string[]).join(
                        "\n",
                      )
                    : "",
                  minFilingAgeMinutes: String(
                    Number(readConfig(source, "minFilingAgeMinutes") ?? 0),
                  ),
                })
              }
            />
          ))}
        </div>
      )}

      <AddSourceDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={() => void load({ soft: true })}
      />
      <ConfigureSourceDialog
        state={configure}
        onOpenChange={(open) => {
          if (!open) setConfigure(null);
        }}
        onSaved={() => {
          setConfigure(null);
          void load({ soft: true });
        }}
      />
    </div>
  );
}

function SourceCard({
  source,
  onChanged,
  onConfigure,
}: {
  source: Source;
  onChanged: () => void;
  onConfigure: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const lastScan = source.lastSignalAt
    ? formatRelative(source.lastSignalAt)
    : source.lastPollResult
      ? "polled recently"
      : "never";

  const onToggle = async (enabled: boolean) => {
    setPending(true);
    setActionError(null);
    try {
      if (!enabled && source.attachedSessionCount > 0) {
        const ok = await confirm({
          title: "Disable this source?",
          description: `Disable this source for ${source.attachedSessionCount} subscribed sessions? Sessions will stay subscribed but move to waiting state until the source is enabled again.`,
          confirmLabel: "Disable",
          variant: "destructive",
        });
        if (!ok) return;
      }
      if (enabled) await api.enableSignalSource(source.id);
      else await api.disableSignalSource(source.id);
      onChanged();
    } catch {
      setActionError("Failed to update source.");
    } finally {
      setPending(false);
    }
  };

  const remove = async () => {
    const names = source.attachedSessionNames.join(", ");
    const description =
      source.attachedSessionCount > 0
        ? `This source is subscribed by ${source.attachedSessionCount} sessions: ${names}. Removing it will unsubscribe all of them.`
        : "This cannot be undone.";
    const ok = await confirm({
      title: "Delete this source?",
      description,
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!ok) return;
    setPending(true);
    setActionError(null);
    try {
      await api.deleteSignalSource(source.id);
      onChanged();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setPending(false);
    }
  };

  return (
    <article className="flex flex-col rounded-sm border border-border bg-surface p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <HealthDot status={source.runtimeStatus} />
          <h3 className="m-0 truncate font-sans text-label text-text1">
            {source.name}
          </h3>
        </div>
        <Badge variant={typeBadgeVariant(source.type)} size="sm">
          {formatSourceType(source.type)}
        </Badge>
      </div>

      {actionError ? (
        <p className="mb-2 m-0 font-sans text-caption text-error" role="alert">
          {actionError}
        </p>
      ) : null}
      <div className="mb-3 space-y-1 font-mono text-caption text-text3">
        <div>Last scan · {lastScan}</div>
        <div className="truncate">
          {formatSignalSourceTimingSubtitle(source)}
        </div>
        {source.runtimeLastError ? (
          <div className="text-error">{source.runtimeLastError}</div>
        ) : null}
        {testResult ? <div className="text-text2">{testResult}</div> : null}
      </div>

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-hairline pt-3">
        <HelpTooltip
          topic="Enable source"
          body="Disabling keeps subscriptions in place, but subscribed sessions wait until re-enabled."
        >
          <Switch
            checked={source.enabled}
            disabled={pending}
            onCheckedChange={onToggle}
          />
        </HelpTooltip>
        <div className="flex flex-wrap justify-end gap-1">
          {source.type === "edgar_8k" || source.type === "mock" ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={async () => {
                setPending(true);
                setTestResult(null);
                try {
                  const result = await api.testSignalSource(source.id);
                  setTestResult(
                    source.type === "mock"
                      ? `Test: ${result.result.detected} emitted`
                      : `Poll: ${result.result.detected} detected`,
                  );
                  onChanged();
                } catch (err) {
                  setTestResult(
                    err instanceof Error
                      ? err.message
                      : "Signal source test failed.",
                  );
                } finally {
                  setPending(false);
                }
              }}
            >
              Test
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={onConfigure}
          >
            Configure
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-error"
            disabled={pending}
            onClick={() => void remove()}
          >
            Remove
          </Button>
        </div>
      </div>
    </article>
  );
}

function HealthDot({ status }: { status: Source["runtimeStatus"] }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 shrink-0 rounded-full",
        status === "running" && "bg-success",
        status === "paused" && "bg-warning",
        status === "restarting" && "bg-info",
        status === "error" && "bg-error",
        status === "idle" && "bg-text3",
      )}
      title={status}
    />
  );
}

function AddSourceDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [type, setType] = useState<"edgar_8k" | "mock" | "">("");
  const [name, setName] = useState("");
  const [marketHours, setMarketHours] = useState("3");
  const [offHours, setOffHours] = useState("15");
  const [mockTicker, setMockTicker] = useState("NVDA");
  const [mockIntervalMinutes, setMockIntervalMinutes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setType("");
      setName("");
      setMarketHours("3");
      setOffHours("15");
      setMockTicker("NVDA");
      setMockIntervalMinutes("");
      setSaving(false);
      setError(null);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg border-border bg-surface">
        <h3 className="m-0 font-sans text-head text-text1">
          Add signal source
        </h3>
        <div className="grid gap-2 font-sans text-body">
          <label className="grid gap-1 rounded-sm border border-border p-3">
            <span className="flex items-center gap-2">
              <input
                type="radio"
                checked={type === "edgar_8k"}
                onChange={() => {
                  setType("edgar_8k");
                  setName("EDGAR 8-K");
                }}
              />
              <span>EDGAR 8-K</span>
              <HelpTooltip glossaryId="signal-type-edgar-8k" />
            </span>
            <span className="font-sans text-caption text-text3">
              Polls SEC EDGAR for 8-K filings in real time. Free, no API key.
            </span>
          </label>
          <label className="grid gap-1 rounded-sm border border-border p-3">
            <span className="flex items-center gap-2">
              <input
                type="radio"
                checked={type === "mock"}
                onChange={() => {
                  setType("mock");
                  setName("Mock rehearsal");
                }}
              />
              <span>Mock rehearsal</span>
              <HelpTooltip glossaryId="signal-type-mock" />
            </span>
            <span className="font-sans text-caption text-text3">
              Synthetic filing-style signals for mock broker rehearsal.
            </span>
          </label>
        </div>
        {type ? (
          <div className="grid gap-3">
            <InputField label="Name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass}
              />
            </InputField>
            {type === "edgar_8k" ? (
              <div className="grid grid-cols-2 gap-3">
                <InputField
                  label="Poll interval (market hours)"
                  glossaryId="edgar-poll-interval"
                >
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={marketHours}
                    onChange={(e) => setMarketHours(e.target.value)}
                    className={inputClass}
                  />
                </InputField>
                <InputField
                  label="Poll interval (off-hours)"
                  glossaryId="edgar-poll-interval"
                >
                  <input
                    type="number"
                    min={5}
                    max={1440}
                    value={offHours}
                    onChange={(e) => setOffHours(e.target.value)}
                    className={inputClass}
                  />
                </InputField>
              </div>
            ) : null}
            {type === "mock" ? (
              <div className="grid gap-3">
                <InputField label="Ticker">
                  <input
                    value={mockTicker}
                    onChange={(e) =>
                      setMockTicker(e.target.value.toUpperCase())
                    }
                    className={inputClass}
                    placeholder="NVDA"
                  />
                </InputField>
                <InputField label="Auto-fire interval (minutes, optional)">
                  <input
                    type="number"
                    min={1}
                    value={mockIntervalMinutes}
                    onChange={(e) => setMockIntervalMinutes(e.target.value)}
                    className={inputClass}
                    placeholder="Leave blank for manual fire only"
                  />
                </InputField>
              </div>
            ) : null}
          </div>
        ) : null}
        {error ? (
          <div className="font-sans text-caption text-error">
            Failed to add source: {error}
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!type || !name.trim() || saving}
            onClick={async () => {
              if (!type) return;
              setSaving(true);
              setError(null);
              try {
                await api.createSignalSource({
                  type,
                  name: name.trim(),
                  config:
                    type === "edgar_8k"
                      ? {
                          pollIntervalMarketMinutes: Number(marketHours) || 3,
                          pollIntervalOffHoursMinutes: Number(offHours) || 15,
                        }
                      : type === "mock"
                        ? {
                            ticker: mockTicker.trim() || "NVDA",
                            instrumentClass: "stock",
                            ...(Number(mockIntervalMinutes) > 0
                              ? {
                                  intervalMs:
                                    Number(mockIntervalMinutes) * 60_000,
                                }
                              : {}),
                          }
                        : undefined,
                });
                onOpenChange(false);
                onCreated();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Unknown error");
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Adding…" : "Add source"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ConfigureSourceDialog({
  state,
  onOpenChange,
  onSaved,
}: {
  state: ConfigureState | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<ConfigureState | null>(state);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm(state);
    setSaving(false);
    setError(null);
  }, [state]);

  if (!state || !form) return null;
  const runtimeAffectingChanged =
    form.source.type === "edgar_8k" &&
    (String(readConfig(form.source, "pollIntervalMarketMinutes") ?? 3) !==
      form.pollIntervalMarketMinutes ||
      String(readConfig(form.source, "pollIntervalOffHoursMinutes") ?? 15) !==
        form.pollIntervalOffHoursMinutes ||
      (Array.isArray(readConfig(form.source, "cikWhitelist"))
        ? (readConfig(form.source, "cikWhitelist") as string[]).join("\n")
        : "") !== form.cikWhitelist ||
      String(readConfig(form.source, "minFilingAgeMinutes") ?? 0) !==
        form.minFilingAgeMinutes);

  return (
    <Dialog open={Boolean(state)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl border-border bg-surface">
        <h3 className="m-0 font-sans text-head text-text1">
          Configure · {form.source.name}
        </h3>
        <div className="grid gap-3">
          <InputField label="Name">
            <input
              value={form.name}
              onChange={(event) => {
                setForm((current) =>
                  current ? { ...current, name: event.target.value } : current,
                );
              }}
              className={inputClass}
            />
          </InputField>
          <InputField label="Description">
            <textarea
              value={form.description}
              onChange={(event) => {
                setForm((current) =>
                  current
                    ? { ...current, description: event.target.value }
                    : current,
                );
              }}
              rows={3}
              className={textareaClass}
            />
          </InputField>
          {form.source.type === "edgar_8k" ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <InputField
                  label="Poll interval · market (min)"
                  glossaryId="edgar-poll-interval"
                >
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={form.pollIntervalMarketMinutes}
                    onChange={(event) => {
                      setForm((current) =>
                        current
                          ? {
                              ...current,
                              pollIntervalMarketMinutes: event.target.value,
                            }
                          : current,
                      );
                    }}
                    className={inputClass}
                  />
                </InputField>
                <InputField
                  label="Poll interval · off-hours (min)"
                  glossaryId="edgar-poll-interval"
                >
                  <input
                    type="number"
                    min={5}
                    max={1440}
                    value={form.pollIntervalOffHoursMinutes}
                    onChange={(event) => {
                      setForm((current) =>
                        current
                          ? {
                              ...current,
                              pollIntervalOffHoursMinutes: event.target.value,
                            }
                          : current,
                      );
                    }}
                    className={inputClass}
                  />
                </InputField>
              </div>
              <InputField
                label="CIK whitelist (optional, one per line)"
                glossaryId="edgar-cik-whitelist"
              >
                <textarea
                  value={form.cikWhitelist}
                  onChange={(event) => {
                    setForm((current) =>
                      current
                        ? { ...current, cikWhitelist: event.target.value }
                        : current,
                    );
                  }}
                  rows={4}
                  className={textareaClass}
                />
              </InputField>
              <InputField
                label="Min signal age before emitting (min)"
                glossaryId="edgar-min-filing-age"
              >
                <input
                  type="number"
                  min={0}
                  max={60}
                  value={form.minFilingAgeMinutes}
                  onChange={(event) => {
                    setForm((current) =>
                      current
                        ? {
                            ...current,
                            minFilingAgeMinutes: event.target.value,
                          }
                        : current,
                    );
                  }}
                  className={inputClass}
                />
              </InputField>
            </>
          ) : null}
          {runtimeAffectingChanged ? (
            <div className="font-sans text-caption text-text3">
              Saving will briefly reconnect this source.
            </div>
          ) : null}
        </div>
        {error ? (
          <div className="font-sans text-caption text-error">{error}</div>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              setError(null);
              try {
                await api.updateSignalSource({
                  id: form.source.id,
                  name: form.name.trim(),
                  description: form.description.trim() || null,
                  config:
                    form.source.type === "edgar_8k"
                      ? {
                          pollIntervalMarketMinutes:
                            Number(form.pollIntervalMarketMinutes) || 3,
                          pollIntervalOffHoursMinutes:
                            Number(form.pollIntervalOffHoursMinutes) || 15,
                          cikWhitelist: form.cikWhitelist
                            .split(/\n+/)
                            .map((value) => value.trim())
                            .filter(Boolean),
                          minFilingAgeMinutes:
                            Number(form.minFilingAgeMinutes) || 0,
                        }
                      : undefined,
                });
                onSaved();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Save failed.");
              } finally {
                setSaving(false);
              }
            }}
          >
            Save changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InputField({
  label,
  children,
  glossaryId,
}: {
  label: string;
  children: ReactNode;
  glossaryId?: HelpGlossaryId;
}) {
  return (
    <label className="grid gap-1.5 font-sans text-caption">
      <span className="inline-flex items-center gap-1 font-mono text-micro uppercase tracking-wider text-text3">
        {label}
        {glossaryId ? (
          <HelpTooltip glossaryId={glossaryId} topic={label} />
        ) : null}
      </span>
      {children}
    </label>
  );
}

function readConfig(source: Source, key: string): unknown {
  try {
    const parsed = JSON.parse(source.configJson || "{}");
    return parsed?.[key];
  } catch {
    return undefined;
  }
}

function formatSourceType(type: Source["type"]): string {
  if (type === "edgar_8k") return "EDGAR";
  if (type === "mock") return "Mock";
  if (type === "prediction_event") return "Prediction";
  return type.replace(/_/g, " ");
}

function typeBadgeVariant(
  type: Source["type"],
): "default" | "success" | "blue" | "purple" {
  if (type === "edgar_8k") return "blue";
  if (type === "mock") return "purple";
  if (type === "prediction_event") return "success";
  return "default";
}

const inputClass =
  "rounded-sm border border-hairline bg-surface2 px-2 py-2 font-sans text-body text-text1";
const textareaClass =
  "w-full rounded-sm border border-hairline bg-surface2 px-2 py-2 font-sans text-body text-text1";
