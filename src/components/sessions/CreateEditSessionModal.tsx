import { useEffect, useMemo, useState } from "react";
import { api, type SessionCreateInput, type SessionSummary } from "@/lib/exva";
import type { InstrumentClass, SessionTemplatePayload } from "@/lib/types";
import { ShadcnSelect } from "@/components/custom-ui";
import { Button, Checkbox, Dialog, DialogContent, Switch } from "@/components/ui";

interface Props {
  open: boolean;
  initialSession?: SessionSummary | null;
  templateInput?: SessionCreateInput | null;
  templateWarnings?: string[];
  onClose: () => void;
  onSubmit: (input: SessionCreateInput, sessionId?: string) => Promise<void>;
}

export const CreateEditSessionModal = ({
  open,
  initialSession,
  templateInput,
  templateWarnings,
  onClose,
  onSubmit,
}: Props) => {
  const [form, setForm] = useState<SessionCreateInput>(defaultInput());
  const [saving, setSaving] = useState(false);
  const [loadingSeed, setLoadingSeed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setError(null);

    if (templateInput) {
      setForm(templateInput);
      return;
    }

    if (!initialSession) {
      setForm(defaultInput());
      return;
    }

    setLoadingSeed(true);
    void api
      .buildTemplatePayloadFromSession(initialSession.id)
      .then((payload) => {
        if (cancelled) return;
        setForm(payloadToInput(payload, initialSession.name));
      })
      .catch((seedError: Error) => {
        if (cancelled) return;
        setError(seedError.message);
        setForm(summaryToInput(initialSession));
      })
      .finally(() => {
        if (!cancelled) setLoadingSeed(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, initialSession, templateInput]);

  const brokerIdsText = useMemo(() => form.brokerAccountIds.join("\n"), [form.brokerAccountIds]);
  const isValid = form.name.trim().length > 0 && form.objective.trim().length > 0 && form.instrumentClasses.length > 0;

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-[96vw] overflow-auto rounded-[20px] border-border bg-transparent p-0 sm:max-w-[920px]">
      <div style={panelStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20 }}>{initialSession ? "Refine Session" : "Create Session"}</h2>
            <div style={{ marginTop: 6, color: "var(--text3)", fontSize: 13 }}>
              Identity, task boundary, and execution routing in one place.
            </div>
          </div>
          <Button onClick={onClose} variant="ghost" className="h-auto p-1 text-[var(--text3)]">✕</Button>
        </div>

        {templateWarnings?.length ? (
          <div style={warningBannerStyle}>
            Template fallback cleared {templateWarnings.length} unavailable field{templateWarnings.length === 1 ? "" : "s"}: {templateWarnings.join(", ")}
          </div>
        ) : null}
        {error ? <div style={errorBannerStyle}>{error}</div> : null}

        <div style={{ display: "grid", gap: 16 }}>
          <section style={sectionStyle}>
            <SectionHeader title="Identity" caption="The operator-facing shell for this session." />
            <div style={twoColumnGridStyle}>
              <Field label="Session name">
                <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Income Engine" style={inputStyle} />
              </Field>
              <Field label="Capital limit (USD)">
                <input
                  value={String(form.capitalLimitUsd)}
                  onChange={(event) => setForm({ ...form, capitalLimitUsd: Number(event.target.value) || 0 })}
                  type="number"
                  min={0}
                  style={inputStyle}
                />
              </Field>
            </div>
            <Field label="Objective">
              <textarea value={form.objective} onChange={(event) => setForm({ ...form, objective: event.target.value })} rows={4} style={textareaStyle} />
            </Field>
          </section>

          <section style={sectionStyle}>
            <SectionHeader title="Task Boundary" caption="Universe selection, scope, and search-provider behavior." />
            <div style={twoColumnGridStyle}>
              <Field label="Selection mode">
                <ShadcnSelect
                  value={form.selectionMode}
                  onValueChange={(value) =>
                    setForm({ ...form, selectionMode: value as SessionCreateInput["selectionMode"] })
                  }
                  options={[
                    { value: "manual_shortlist", label: "Manual shortlist" },
                    { value: "ai_selected_universe", label: "AI selected universe" },
                  ]}
                />
              </Field>
              <Field label="Search provider override">
                <input
                  value={form.defaultSearchProviderId ?? ""}
                  onChange={(event) => setForm({
                    ...form,
                    defaultSearchProviderId: event.target.value.trim() ? event.target.value.trim() : null,
                  })}
                  placeholder="workspace default"
                  style={inputStyle}
                />
              </Field>
            </div>
            <Field label="Instrument classes">
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {(["stock", "crypto", "futures", "prediction_market"] as const).map((instrumentClass) => {
                  const checked = form.instrumentClasses.includes(instrumentClass);
                  return (
                    <label key={instrumentClass} style={{ ...toggleChipStyle, borderColor: checked ? "var(--accent-dim)" : "var(--border)" }}>
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(nextChecked) =>
                          setForm({
                            ...form,
                            instrumentClasses: toggleInstrumentClass(form.instrumentClasses, instrumentClass, nextChecked === true),
                          })
                        }
                      />
                      {formatInstrumentClass(instrumentClass)}
                    </label>
                  );
                })}
              </div>
            </Field>
            <Field label="Instrument scope">
              <textarea
                value={form.instrumentScope}
                onChange={(event) => setForm({ ...form, instrumentScope: event.target.value })}
                placeholder="SPY\nQQQ\nNVDA"
                rows={4}
                style={textareaStyle}
              />
            </Field>
            <label style={switchRowStyle}>
              <Switch
                checked={form.selectorSettings.aiPickerEnabled}
                onCheckedChange={(checked) =>
                  setForm({
                    ...form,
                    selectorSettings: { aiPickerEnabled: checked },
                  })
                }
              />
              <span>
                <span style={{ display: "block", color: "var(--text1)", fontWeight: 600 }}>AI picker enabled</span>
                <span style={{ display: "block", marginTop: 2, color: "var(--text3)", fontSize: 12 }}>
                  Allow the selector role to expand or refine the shortlist when the session calls for it.
                </span>
              </span>
            </label>
          </section>

          <section style={sectionStyle}>
            <SectionHeader title="Execution Setup" caption="Broker attachments and routing overrides." />
            <div style={twoColumnGridStyle}>
              <Field label="Execution mode">
                <ShadcnSelect
                  value={form.executionMode}
                  onValueChange={(value) =>
                    setForm({ ...form, executionMode: value as SessionCreateInput["executionMode"] })
                  }
                  options={[
                    { value: "paper_only", label: "Paper only" },
                    { value: "live_allowed", label: "Live allowed" },
                  ]}
                />
              </Field>
              <Field label="Assigned broker account IDs">
                <textarea
                  value={brokerIdsText}
                  onChange={(event) => setForm({ ...form, brokerAccountIds: parseListInput(event.target.value) })}
                  rows={4}
                  placeholder="default-broker"
                  style={textareaStyle}
                />
              </Field>
            </div>
            <div style={threeColumnGridStyle}>
              {(["stock", "crypto", "futures", "prediction_market"] as const).map((instrumentClass) => (
                <Field key={instrumentClass} label={`${formatInstrumentClass(instrumentClass)} route override`}>
                  <input
                    value={form.brokerOverridesByInstrumentClass?.[instrumentClass] ?? ""}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        brokerOverridesByInstrumentClass: {
                          ...form.brokerOverridesByInstrumentClass,
                          [instrumentClass]: event.target.value.trim() ? event.target.value.trim() : null,
                        },
                      })
                    }
                    placeholder="inherit assignment"
                    style={inputStyle}
                  />
                </Field>
              ))}
            </div>
          </section>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 20, flexWrap: "wrap" }}>
          <div style={{ color: "var(--text3)", fontSize: 12 }}>
            {loadingSeed ? "Loading persisted strategy, broker assignments, and routing..." : ""}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <Button onClick={onClose} variant="outline" className="border-border bg-[var(--surface2)] text-[var(--text2)]">Cancel</Button>
            <Button
              onClick={async () => {
                setSaving(true);
                setError(null);
                try {
                  await onSubmit(form, initialSession?.id);
                  onClose();
                } catch (submitError) {
                  setError(submitError instanceof Error ? submitError.message : "Failed to save session.");
                } finally {
                  setSaving(false);
                }
              }}
              className="bg-[var(--accent)] text-white"
              disabled={saving || loadingSeed || !isValid}
            >
              {saving ? "Saving..." : initialSession ? "Save Session" : "Create Session"}
            </Button>
          </div>
        </div>
      </div>
      </DialogContent>
    </Dialog>
  );
};

const SectionHeader = ({ title, caption }: { title: string; caption: string }) => (
  <div style={{ marginBottom: 14 }}>
    <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text3)" }}>{title}</div>
    <div style={{ marginTop: 6, color: "var(--text2)", fontSize: 13 }}>{caption}</div>
  </div>
);

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label style={{ display: "grid", gap: 8 }}>
    <span style={{ color: "var(--text2)", fontSize: 12, fontWeight: 600 }}>{label}</span>
    {children}
  </label>
);

function defaultInput(): SessionCreateInput {
  return {
    name: "",
    objective: "",
    selectionMode: "manual_shortlist",
    instrumentClasses: ["stock"],
    instrumentScope: "SPY,QQQ",
    defaultSearchProviderId: null,
    selectorSettings: { aiPickerEnabled: true },
    capitalLimitUsd: 10000,
    executionMode: "paper_only",
    brokerAccountIds: ["default-broker"],
    brokerOverridesByInstrumentClass: {},
  };
}

function payloadToInput(payload: SessionTemplatePayload, name = ""): SessionCreateInput {
  return {
    name,
    objective: payload.identity.objective,
    selectionMode: payload.identity.selectionMode,
    instrumentClasses: payload.identity.instrumentClasses,
    instrumentScope: payload.identity.instrumentScope,
    defaultSearchProviderId: payload.identity.defaultSearchProviderId,
    selectorSettings: payload.selectorSettings,
    capitalLimitUsd: payload.identity.capitalLimitUsd,
    executionMode: payload.identity.executionMode,
    brokerAccountIds: payload.brokerAssignments.map((assignment) => assignment.brokerAccountId).filter(Boolean),
    brokerOverridesByInstrumentClass: payload.brokerOverridesByInstrumentClass,
  };
}

function summaryToInput(session: SessionSummary): SessionCreateInput {
  return {
    name: session.name,
    objective: session.objective,
    selectionMode: session.selectionMode,
    instrumentClasses: session.instrumentClasses,
    instrumentScope: session.instrumentScope,
    defaultSearchProviderId: session.defaultSearchProviderId,
    selectorSettings: { aiPickerEnabled: true },
    capitalLimitUsd: session.capitalLimitUsd,
    executionMode: session.executionMode,
    brokerAccountIds: ["default-broker"],
    brokerOverridesByInstrumentClass: {},
  };
}

function parseListInput(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function toggleInstrumentClass(current: InstrumentClass[], value: InstrumentClass, checked: boolean): InstrumentClass[] {
  if (checked) {
    return current.includes(value) ? current : [...current, value];
  }
  return current.filter((entry) => entry !== value);
}

function formatInstrumentClass(value: InstrumentClass): string {
  return value === "stock"
    ? "Stocks"
    : value === "crypto"
      ? "Crypto"
      : value === "futures"
        ? "Futures"
        : "Prediction Markets";
}

const panelStyle = { width: 920, maxWidth: "96vw", maxHeight: "92vh", overflow: "auto", background: "linear-gradient(180deg, rgba(13,18,25,0.98), rgba(9,13,18,0.98))", border: "1px solid var(--border)", borderRadius: 20, padding: 24, boxShadow: "0 26px 60px rgba(2,6,23,0.48)" } as const;
const sectionStyle = { border: "1px solid var(--border)", borderRadius: 16, padding: 18, background: "rgba(18,26,36,0.72)" } as const;
const inputStyle = { width: "100%", padding: "11px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "rgba(7,10,15,0.5)", color: "var(--text1)" } as const;
const textareaStyle = { ...inputStyle, resize: "vertical" as const, minHeight: 88 };
const toggleChipStyle = { display: "inline-flex", alignItems: "center", gap: 8, border: "1px solid var(--border)", borderRadius: 999, padding: "8px 11px", background: "rgba(7,10,15,0.38)", color: "var(--text2)", fontSize: 12 } as const;
const switchRowStyle = { display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 14px", borderRadius: 12, border: "1px solid var(--border)", background: "rgba(7,10,15,0.34)" } as const;
const twoColumnGridStyle = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 } as const;
const threeColumnGridStyle = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 } as const;
const warningBannerStyle = { marginBottom: 16, padding: "12px 14px", borderRadius: 12, border: "1px solid rgba(251,191,36,0.34)", background: "rgba(251,191,36,0.08)", color: "#fcd34d", fontSize: 13, lineHeight: 1.5 } as const;
const errorBannerStyle = { marginBottom: 16, padding: "12px 14px", borderRadius: 12, border: "1px solid rgba(248,113,113,0.34)", background: "rgba(248,113,113,0.08)", color: "#fca5a5", fontSize: 13 } as const;
