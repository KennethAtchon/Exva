import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Card, PageShell } from "@/components/custom-ui";
import {
  Button,
  Dialog,
  DialogContent,
  HelpTooltip,
  Switch,
} from "@/components/ui";
import { api } from "@/lib/exva";
import { useExvaEvent } from "@/hooks/useExvaEvent";
import type { HelpGlossaryId } from "@/lib/help-glossary";

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

export function SignalSourcesPage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [configure, setConfigure] = useState<ConfigureState | null>(null);

  const load = async () => {
    setLoading(true);
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

  useExvaEvent("signal_received", () => void load());
  useExvaEvent("signal_delivery_updated", () => void load());

  return (
    <PageShell>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[12px] uppercase tracking-[0.14em] text-[var(--text3)]">
            SIGNAL SOURCES
          </div>
          <h1 className="m-0 mt-2.5 text-[28px]">Signal Sources</h1>
          <p className="mt-2 text-[13px] text-[var(--text3)]">
            Connect real-time data feeds to drive the trading pipeline.
          </p>
          <div className="mt-2">
            <HelpTooltip
              glossaryId="signal-source"
              body="Sources are global. Sessions subscribe to one active source at a time."
            />
          </div>
        </div>
        <Button
          className="bg-[var(--accent)] text-white"
          onClick={() => setAddOpen(true)}
        >
          Add Source
        </Button>
      </div>

      <Card className="!p-0">
        {loading ? (
          <div className="grid gap-3 p-4">
            {[0, 1, 2].map((idx) => (
              <div
                key={idx}
                className="h-[112px] animate-pulse rounded-lg border border-[var(--border)] bg-[var(--surface2)]"
              />
            ))}
          </div>
        ) : error ? (
          <div className="m-4 rounded-lg border border-error-border bg-error-dim px-3 py-2 text-[13px] text-error">
            Failed to load signal sources. Try again.{" "}
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
              No signal sources configured
            </div>
            <p className="m-0 leading-relaxed">
              Signal sources are global. Create one here, then subscribe
              sessions to it when you create or edit a session.
            </p>
          </div>
        ) : (
          <div>
            {sources.map((source) => (
              <SourceRow
                key={source.id}
                source={source}
                onChanged={() => void load()}
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
      </Card>

      <AddSourceDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={() => void load()}
      />
      <ConfigureSourceDialog
        state={configure}
        onOpenChange={(open) => {
          if (!open) setConfigure(null);
        }}
        onSaved={() => {
          setConfigure(null);
          void load();
        }}
      />
    </PageShell>
  );
}

function SourceRow({
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
  const statusLabel = useMemo(() => {
    if (source.runtimeStatus === "running") return "Running";
    if (source.runtimeStatus === "paused") return "Paused";
    if (source.runtimeStatus === "restarting") return "Restarting";
    if (source.runtimeStatus === "error") return "Error";
    return "Idle";
  }, [source.runtimeStatus]);

  const onToggle = async (enabled: boolean) => {
    setPending(true);
    try {
      if (!enabled && source.attachedSessionCount > 0) {
        const confirm = window.confirm(
          `Disable this source for ${source.attachedSessionCount} subscribed sessions? Sessions will stay subscribed but move to waiting state until the source is enabled again.`,
        );
        if (!confirm) return;
      }
      if (enabled) await api.enableSignalSource(source.id);
      else await api.disableSignalSource(source.id);
      onChanged();
    } catch {
      window.alert("Failed to update source.");
    } finally {
      setPending(false);
    }
  };

  const remove = async () => {
    const names = source.attachedSessionNames.join(", ");
    const message =
      source.attachedSessionCount > 0
        ? `This source is subscribed by ${source.attachedSessionCount} sessions: ${names}. Removing it will unsubscribe all of them.`
        : "Delete this source? This cannot be undone.";
    if (!window.confirm(message)) return;
    setPending(true);
    try {
      await api.deleteSignalSource(source.id);
      onChanged();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex items-start gap-4 border-b border-[var(--border)] p-4 last:border-0">
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <div className="text-[13px] font-semibold text-[var(--text1)]">
            {source.name}
          </div>
          <span className={statusBadgeClass(source.runtimeStatus)}>
            {statusLabel}
          </span>
          <HelpTooltip
            topic={`${source.name} status`}
            body={
              source.runtimeStatus === "running"
                ? "The source is actively polling or listening for new events."
                : source.runtimeStatus === "paused"
                  ? "The source is configured but temporarily not polling."
                  : source.runtimeStatus === "restarting"
                    ? "The source is being restarted after a config or runtime change."
                    : source.runtimeStatus === "error"
                      ? "The source hit a runtime error and is not operating normally."
                      : "The source is configured but not actively polling right now."
            }
          />
        </div>
        {source.runtimeLastError ? (
          <div className="mt-1 text-[12px] text-error">
            Error: {source.runtimeLastError}
          </div>
        ) : null}
        <div className="mt-1 text-[12px] text-[var(--text3)]">
          {source.description ?? describeSourceType(source.type)}
        </div>
        <div className="mt-1 text-[12px] text-[var(--text3)]">
          {source.lastSignalAt && source.lastSignalTicker
            ? `Last signal: ${source.lastSignalTicker}, ${formatRelative(source.lastSignalAt)}`
            : "No signals yet"}
        </div>
        <div className="mt-1 text-[12px] text-[var(--text3)]">
          {source.lastPollResult
            ? `Last poll: ${source.lastPollResult.detected} detected, ${source.lastPollResult.passed} passed to sessions, ${source.lastPollResult.dropped} dropped`
            : "No polls yet"}
        </div>
        {testResult ? (
          <div className="mt-1 text-[12px] text-[var(--text2)]">
            {testResult}
          </div>
        ) : null}
        <div className="mt-1 text-[12px] text-[var(--text3)]">
          {source.attachedSessionCount > 0
            ? `Used by ${source.attachedSessionCount} sessions`
            : "Not attached to any sessions"}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Switch
          checked={source.enabled}
          disabled={pending}
          onCheckedChange={onToggle}
        />
        <HelpTooltip
          topic="Enable source"
          body="Disabling a source keeps subscriptions in place, but subscribed sessions will wait idle until the source is enabled again."
        />
        {source.type === "edgar_8k" || source.type === "mock" ? (
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              className="h-8 text-xs"
              disabled={pending}
              onClick={async () => {
                setPending(true);
                setTestResult(null);
                try {
                  const result = await api.testSignalSource(source.id);
                  setTestResult(
                    source.type === "mock"
                      ? `Test signal: ${result.result.detected} emitted, ${result.result.passed} passed, ${result.result.dropped} dropped.`
                      : `Test poll: ${result.result.detected} detected, ${result.result.passed} passed, ${result.result.dropped} dropped.`,
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
            <HelpTooltip
              topic="Test source"
              body={
                source.type === "mock"
                  ? "Emits one synthetic signal and enqueues deliveries for subscribed sessions."
                  : "Runs one poll now and reports detections. It does not enqueue session deliveries."
              }
            />
          </div>
        ) : null}
        <Button
          variant="outline"
          className="h-8 text-xs"
          disabled={pending}
          onClick={onConfigure}
        >
          Configure
        </Button>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            className="h-8 text-xs text-error"
            disabled={pending}
            onClick={() => void remove()}
          >
            Remove
          </Button>
          <HelpTooltip glossaryId="remove-signal-source" />
        </div>
      </div>
    </div>
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
  const [type, setType] = useState<"edgar_8k" | "web_search" | "mock" | "">("");
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
      <DialogContent className="max-w-[520px] border-border bg-[var(--surface)]">
        <h3 className="m-0 text-[17px] font-semibold">Add Signal Source</h3>
        <div className="grid gap-2 text-[13px]">
          <label className="grid gap-1 rounded-lg border border-[var(--border)] p-3">
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
            <span className="text-[12px] text-[var(--text3)]">
              Polls SEC EDGAR for 8-K filings in real time. Free, no API key.
            </span>
          </label>
          <label className="grid gap-1 rounded-lg border border-[var(--border)] p-3">
            <span className="flex items-center gap-2">
              <input
                type="radio"
                checked={type === "web_search"}
                onChange={() => {
                  setType("web_search");
                  setName("Web Search");
                }}
              />
              <span>Web Search</span>
              <HelpTooltip glossaryId="signal-type-web-search" />
            </span>
            <span className="text-[12px] text-[var(--text3)]">
              Legacy: uses web search and trending symbols to find candidates.
              Lower edge.
            </span>
          </label>
          <label className="grid gap-1 rounded-lg border border-[var(--border)] p-3">
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
            <span className="text-[12px] text-[var(--text3)]">
              Synthetic filing-style signals for mock broker rehearsal. Fire
              manually or on an optional interval.
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
          <div className="text-[12px] text-error">
            Failed to add source: {error}
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="bg-[var(--accent)] text-white"
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
            {saving ? "Adding..." : "Add Source"}
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
      <DialogContent className="max-w-[560px] border-border bg-[var(--surface)]">
        <h3 className="m-0 text-[17px] font-semibold">
          Configure - {form.source.name}
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
                  label="Poll interval - market hours (min)"
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
                  label="Poll interval - off-hours (min)"
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
            <div className="text-[12px] text-[var(--text3)]">
              Saving will briefly reconnect this source.
            </div>
          ) : null}
          {form.source.type === "edgar_8k" &&
          form.source.recentActivity.length > 0 ? (
            <div className="grid gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface2)] p-3">
              <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--text3)]">
                Recent activity
              </div>
              <div className="max-h-[180px] overflow-auto">
                <div className="grid gap-2">
                  {form.source.recentActivity.map((entry, index) => (
                    <div
                      key={`${entry.at}-${index}`}
                      className="text-[12px] text-[var(--text2)]"
                    >
                      {formatRelative(entry.at)} - {entry.summary}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>
        {error ? <div className="text-[12px] text-error">{error}</div> : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="bg-[var(--accent)] text-white"
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
            Save Changes
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
    <label className="grid gap-1.5 text-[12px]">
      <span className="inline-flex items-center gap-1 uppercase tracking-[0.08em] text-[var(--text3)]">
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

function describeSourceType(type: Source["type"]): string {
  if (type === "edgar_8k") {
    return "Polls SEC EDGAR for 8-K filings.";
  }
  if (type === "mock") {
    return "Synthetic filing-style signals for rehearsal.";
  }
  return "Legacy wrapper for web-search discovery.";
}

function statusBadgeClass(status: Source["runtimeStatus"]): string {
  if (status === "running") {
    return "rounded-full border border-success-border bg-success-dim px-2 py-[2px] text-[11px] text-success";
  }
  if (status === "paused") {
    return "rounded-full border border-warning-border bg-warning-dim px-2 py-[2px] text-[11px] text-warning";
  }
  if (status === "restarting") {
    return "rounded-full border border-info-border bg-info-dim px-2 py-[2px] text-[11px] text-info";
  }
  if (status === "error") {
    return "rounded-full border border-error-border bg-error-dim px-2 py-[2px] text-[11px] text-error";
  }
  return "rounded-full border border-[var(--border)] px-2 py-[2px] text-[11px] text-[var(--text2)]";
}

function formatRelative(value: string): string {
  const diffMs = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(diffMs)) return value;
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}

const inputClass =
  "rounded-md border border-[var(--border)] bg-[var(--surface2)] px-2 py-2 text-[13px]";
const textareaClass =
  "rounded-md border border-[var(--border)] bg-[var(--surface2)] px-2 py-2 text-[13px]";
