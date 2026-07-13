import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AndonCordCard } from "@/components/autopsy/AndonCordCard";
import { PeriodLessonsPanel } from "@/components/autopsy/PeriodLessonsPanel";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  HelpTooltip,
  DialogTitle,
  Input,
} from "@/components/ui";
import { api } from "@/lib/exva";
import { fmt } from "@/lib/formatters";
import type {
  AutopsyLesson,
  AutopsyScope,
  ExportFormat,
  PeriodAutopsyFilters,
  PeriodAutopsyRecord,
  PeriodAutopsyRunInput,
} from "@/lib/autopsy-types";
import type { ProviderAccount } from "@/lib/types";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { cn } from "@/lib/utils";

const CONFIG_OPEN_KEY = "exva:autopsy:config-open";
const INSTRUMENT_OPTIONS = [
  "stock",
  "crypto",
  "futures",
  "options",
  "prediction_market",
];
const PHASE_OPTIONS = [
  "selector",
  "technical",
  "fundamental",
  "review",
  "decision",
];

type PresetKey = "since_last" | "last_7" | "last_30" | "custom";

const DEFAULT_FILTERS: PeriodAutopsyFilters = {
  instrumentClasses: [],
  brokerAccountIds: [],
  outcome: "all",
  minPositionSizeUsd: 0,
  includeAgentPhases: [],
};

function formatPageDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function toDateInput(iso: string): string {
  return iso.slice(0, 10);
}

function startOfDayIso(value: string): string {
  return `${value}T00:00:00.000Z`;
}

function endOfDayIso(value: string): string {
  return `${value}T23:59:59.999Z`;
}

function daysAgoIso(days: number): string {
  const next = new Date();
  next.setUTCDate(next.getUTCDate() - days);
  next.setUTCHours(0, 0, 0, 0);
  return next.toISOString();
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseTradeIds(record: PeriodAutopsyRecord | null): string[] {
  if (!record) return [];
  try {
    const parsed = JSON.parse(record.tradeIdsJson) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

function parseFilters(
  record: PeriodAutopsyRecord | null,
): PeriodAutopsyFilters {
  if (!record) return DEFAULT_FILTERS;
  try {
    return {
      ...DEFAULT_FILTERS,
      ...(JSON.parse(record.filtersJson) as PeriodAutopsyFilters),
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

function isAndonActive(lesson: AutopsyLesson): boolean {
  return (
    (lesson.status === "pending" || lesson.status === "recurring") &&
    (lesson.severity === "high" || lesson.severity === "critical") &&
    lesson.recurrenceCount >= 3
  );
}

function ExportMenu({
  onExport,
}: {
  onExport: (format: ExportFormat) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button
        variant="outline"
        className="h-9 border-border bg-transparent px-3 text-sm text-[var(--text2)]"
        onClick={() => setOpen((current) => !current)}
      >
        ↓ Export
      </Button>
      {open ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-50 mt-2 min-w-[180px] rounded-xl border border-border bg-card p-1 shadow-xl">
            {(
              [
                ["Markdown (.md)", "markdown"],
                ["JSON (.json)", "json"],
                ["PDF (.pdf)", "pdf"],
              ] as Array<[string, ExportFormat]>
            ).map(([label, format]) => (
              <button
                key={format}
                type="button"
                className="block w-full rounded-lg px-3 py-2 text-left text-sm text-[var(--text1)] hover:bg-[var(--surface2)]"
                onClick={() => {
                  setOpen(false);
                  onExport(format);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function VersionChips({
  autopsies,
  selectedId,
  onSelect,
}: {
  autopsies: PeriodAutopsyRecord[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (autopsies.length <= 1) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {autopsies.map((autopsy, index) => (
        <button
          key={autopsy.id}
          type="button"
          onClick={() => onSelect(autopsy.id)}
          className={cn(
            "rounded-full border px-3 py-1.5 text-xs",
            selectedId === autopsy.id
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border bg-[var(--surface2)] text-[var(--text2)]",
          )}
        >
          v{autopsies.length - index} · {autopsy.createdAt.slice(5, 10)}
        </button>
      ))}
    </div>
  );
}

function Section({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-[14px] border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold text-[var(--text1)]">
          {title}
        </span>
        <span className="text-xs text-[var(--text3)]">{open ? "▲" : "▼"}</span>
      </button>
      {open ? (
        <div className="border-t border-border px-4 py-4">{children}</div>
      ) : null}
    </div>
  );
}

export function PeriodAutopsyPage({
  initialScope = "global",
  initialSessionId = null,
  initialPeriodAutopsyId = null,
  onReviewTrade,
}: {
  initialScope?: AutopsyScope;
  initialSessionId?: string | null;
  initialPeriodAutopsyId?: string | null;
  onReviewTrade: (tradeId: string) => void;
}) {
  const queryClient = useQueryClient();
  const environmentMode = useWorkspaceStore((state) => state.environmentMode);
  const andonRef = useRef<HTMLDivElement | null>(null);

  const [scope, setScope] = useState<AutopsyScope>(initialScope);
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId);
  const [selectedAutopsyId, setSelectedAutopsyId] = useState<string | null>(
    initialPeriodAutopsyId,
  );
  const [configOpen, setConfigOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const stored = window.localStorage.getItem(CONFIG_OPEN_KEY);
    return stored == null ? true : stored === "true";
  });
  const [preset, setPreset] = useState<PresetKey>("since_last");
  const [windowStart, setWindowStart] = useState(daysAgoIso(30));
  const [windowEnd, setWindowEnd] = useState(nowIso());
  const [filters, setFilters] = useState<PeriodAutopsyFilters>(DEFAULT_FILTERS);
  const [useWorkspaceDefaultModel, setUseWorkspaceDefaultModel] =
    useState(true);
  const [providerKey, setProviderKey] = useState("");
  const [modelId, setModelId] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    window.localStorage.setItem(CONFIG_OPEN_KEY, String(configOpen));
  }, [configOpen]);

  useEffect(() => {
    setScope(initialScope);
    setSessionId(initialSessionId);
    setSelectedAutopsyId(initialPeriodAutopsyId);
  }, [initialPeriodAutopsyId, initialScope, initialSessionId]);

  const { data: sessionsData } = useQuery({
    queryKey: ["period-autopsy-sessions", environmentMode],
    queryFn: () =>
      api.listSessions({
        includeArchived: false,
        executionMode:
          environmentMode === "live" ? "live_allowed" : "paper_only",
      }),
  });

  const sessions = useMemo(
    () => sessionsData?.sessions ?? [],
    [sessionsData?.sessions],
  );

  useEffect(() => {
    if (scope === "session" && !sessionId && sessions[0]) {
      setSessionId(sessions[0].id);
    }
  }, [scope, sessionId, sessions]);

  const scopeLabel =
    scope === "global"
      ? "Global"
      : `Session: ${sessions.find((item) => item.id === sessionId)?.name ?? "Select session"}`;

  const { data: autopsiesData } = useQuery({
    queryKey: ["period-autopsies", scope, sessionId],
    queryFn: () =>
      api.listPeriodAutopsies({
        scope,
        sessionId: scope === "session" ? (sessionId ?? undefined) : undefined,
        limit: 100,
        offset: 0,
      }),
    enabled: scope === "global" || Boolean(sessionId),
  });

  const autopsies = useMemo(
    () => autopsiesData?.items ?? [],
    [autopsiesData?.items],
  );
  const latestAutopsy = autopsies[0] ?? null;

  useEffect(() => {
    if (!latestAutopsy) {
      if (preset === "since_last") {
        setWindowStart(daysAgoIso(30));
        setWindowEnd(nowIso());
      }
      setSelectedAutopsyId(null);
      return;
    }
    if (
      !selectedAutopsyId ||
      !autopsies.some((item) => item.id === selectedAutopsyId)
    ) {
      setSelectedAutopsyId(initialPeriodAutopsyId ?? latestAutopsy.id);
    }
    if (preset === "since_last") {
      setWindowStart(latestAutopsy.createdAt);
      setWindowEnd(nowIso());
      setFilters(parseFilters(latestAutopsy));
    }
  }, [
    autopsies,
    initialPeriodAutopsyId,
    latestAutopsy,
    preset,
    selectedAutopsyId,
  ]);

  const selectedAutopsy =
    autopsies.find((item) => item.id === selectedAutopsyId) ?? latestAutopsy;

  const currentInput: PeriodAutopsyRunInput = useMemo(
    () => ({
      scope,
      sessionId: scope === "session" ? (sessionId ?? undefined) : undefined,
      windowStart,
      windowEnd,
      filters,
      ...(useWorkspaceDefaultModel ? {} : { providerKey, modelId }),
    }),
    [
      filters,
      modelId,
      providerKey,
      scope,
      sessionId,
      useWorkspaceDefaultModel,
      windowEnd,
      windowStart,
    ],
  );

  const previewQuery = useQuery({
    queryKey: ["period-autopsy-preview", currentInput],
    queryFn: () => api.previewPeriodAutopsy(currentInput),
    enabled:
      (scope === "global" || Boolean(sessionId)) &&
      (useWorkspaceDefaultModel || Boolean(providerKey && modelId)),
  });

  const { data: workspaceDefaultModel } = useQuery({
    queryKey: ["workspace-default-model"],
    queryFn: () => api.getWorkspaceDefaultModel(),
  });

  const { data: providerList } = useQuery({
    queryKey: ["period-autopsy-providers"],
    queryFn: () => api.listProviders(),
  });

  const aiProviders = useMemo(
    () =>
      (providerList?.providers ?? []).filter(
        (provider): provider is ProviderAccount =>
          provider.category === "ai" && provider.isConfigured,
      ),
    [providerList?.providers],
  );

  useEffect(() => {
    if (!useWorkspaceDefaultModel && !providerKey && aiProviders[0]) {
      setProviderKey(aiProviders[0].id);
    }
  }, [aiProviders, providerKey, useWorkspaceDefaultModel]);

  const { data: providerModels } = useQuery({
    queryKey: ["period-autopsy-provider-models", providerKey],
    queryFn: () => api.getStrategyProviderModels(providerKey),
    enabled: !useWorkspaceDefaultModel && Boolean(providerKey),
  });

  useEffect(() => {
    if (useWorkspaceDefaultModel) {
      setProviderKey(workspaceDefaultModel?.providerKey ?? "");
      setModelId(workspaceDefaultModel?.modelId ?? "");
      return;
    }
    const firstModel = providerModels?.models[0]?.id;
    if (firstModel && !modelId) {
      setModelId(firstModel);
    }
  }, [
    modelId,
    providerModels?.models,
    useWorkspaceDefaultModel,
    workspaceDefaultModel?.modelId,
    workspaceDefaultModel?.providerKey,
  ]);

  const { data: brokersData } = useQuery({
    queryKey: ["period-autopsy-brokers"],
    queryFn: () => api.listBrokerAccounts(),
  });

  const lessonsQuery = useQuery({
    queryKey: ["period-autopsy-lessons", scope, sessionId],
    queryFn: () =>
      api.listPeriodAutopsyLessons({
        scope,
        sessionId: scope === "session" ? (sessionId ?? undefined) : undefined,
      }),
    enabled: scope === "global" || Boolean(sessionId),
  });

  const lessons = lessonsQuery.data ?? [];
  const andonLessons = lessons.filter(isAndonActive);

  const tradeIds = parseTradeIds(selectedAutopsy);
  const includedTradesQuery = useQuery({
    queryKey: [
      "period-autopsy-trades",
      selectedAutopsy?.id,
      tradeIds.join(","),
    ],
    queryFn: async () => {
      const details = await Promise.all(
        tradeIds.map((tradeId) => api.getTradeDetail(tradeId)),
      );
      return details.map((detail) => detail.trade);
    },
    enabled: tradeIds.length > 0,
  });

  const includedTrades = includedTradesQuery.data ?? [];

  const runMutation = useMutation({
    mutationFn: (confirmHighCost: boolean) =>
      api.runPeriodAutopsy({ ...currentInput, confirmHighCost }),
    onSuccess: async (record) => {
      setBannerMessage(null);
      setSelectedAutopsyId(record.id);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["period-autopsies", scope, sessionId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["period-autopsy-lessons", scope, sessionId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["period-autopsy-preview", currentInput],
        }),
      ]);
    },
    onError: (error) => {
      setBannerMessage(
        `Autopsy failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    },
  });

  async function handleExport(
    format: ExportFormat,
    periodAutopsyId?: string | null,
  ) {
    if (!periodAutopsyId) return;
    const result = await api.exportPeriodAutopsy(periodAutopsyId, format);
    if ("cancelled" in result) return;
    if ("error" in result) {
      setBannerMessage(`Export failed: ${result.error}`);
      return;
    }
    setBannerMessage(`Autopsy exported to ${result.filename}`);
  }

  async function handleRun(confirmHighCost = false) {
    if ((previewQuery.data?.tradeCount ?? 0) === 0) return;
    if ((previewQuery.data?.estimatedCostUsd ?? 0) > 5 && !confirmHighCost) {
      setConfirmOpen(true);
      return;
    }
    await runMutation.mutateAsync(confirmHighCost);
    setConfirmOpen(false);
  }

  const metaAutopsy = selectedAutopsy;
  const parsed = metaAutopsy
    ? safeParsePeriodStructured(metaAutopsy.summaryStructuredJson)
    : null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="sticky top-0 z-20 border-b border-border bg-[var(--surface)]">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-[var(--text1)]">
              Autopsy
            </h1>
            <div className="flex rounded-full border border-border bg-[var(--surface2)] p-1">
              <button
                type="button"
                onClick={() => setScope("global")}
                className={cn(
                  "rounded-full px-3 py-1.5 text-sm",
                  scope === "global"
                    ? "bg-primary text-primary-foreground"
                    : "text-[var(--text2)]",
                )}
              >
                Global
              </button>
              <button
                type="button"
                onClick={() => setScope("session")}
                className={cn(
                  "rounded-full px-3 py-1.5 text-sm",
                  scope === "session"
                    ? "bg-primary text-primary-foreground"
                    : "text-[var(--text2)]",
                )}
              >
                Session ▼
              </button>
            </div>
            {scope === "session" ? (
              <select
                value={sessionId ?? ""}
                onChange={(event) => setSessionId(event.target.value || null)}
                className="h-10 rounded-md border border-border bg-[var(--surface2)] px-3 text-sm text-[var(--text1)]"
              >
                {sessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="h-9 border-border bg-transparent px-3 text-sm text-[var(--text2)]"
              disabled={autopsies.length === 0}
              onClick={() => setHistoryOpen(true)}
            >
              History
            </Button>
            {selectedAutopsy ? (
              <ExportMenu
                onExport={(format) =>
                  void handleExport(format, selectedAutopsy.id)
                }
              />
            ) : null}
            <div className="flex items-center gap-1">
              <Button
                className="h-9 px-4 text-sm"
                disabled={
                  runMutation.isPending ||
                  previewQuery.isLoading ||
                  (previewQuery.data?.tradeCount ?? 0) === 0 ||
                  (!useWorkspaceDefaultModel && (!providerKey || !modelId))
                }
                onClick={() => void handleRun()}
              >
                {runMutation.isPending
                  ? "Running..."
                  : autopsies.length > 0
                    ? "Regenerate"
                    : "Run Autopsy"}
              </Button>
              {previewQuery.data ? (
                <HelpTooltip
                  topic="Run period autopsy"
                  body={`Estimated model cost for this run: about $${previewQuery.data.estimatedCostUsd.toFixed(2)}.`}
                />
              ) : null}
            </div>
          </div>
        </div>

        <div className="border-t border-border px-6 py-3">
          <Button
            variant="ghost"
            className="mb-3 h-auto p-0 text-sm text-[var(--text2)]"
            onClick={() => setConfigOpen((current) => !current)}
          >
            {configOpen ? "▲ Configure" : "▼ Configure"}
          </Button>

          {configOpen ? (
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="space-y-3 lg:col-span-2">
                <div className="flex flex-wrap items-center gap-2">
                  {(
                    [
                      ["Since last autopsy", "since_last"],
                      ["Last 7 days", "last_7"],
                      ["Last 30 days", "last_30"],
                    ] as Array<[string, PresetKey]>
                  ).map(([label, key]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setPreset(key);
                        if (key === "since_last") {
                          setWindowStart(
                            latestAutopsy?.createdAt ?? daysAgoIso(30),
                          );
                          setWindowEnd(nowIso());
                        }
                        if (key === "last_7") {
                          setWindowStart(daysAgoIso(7));
                          setWindowEnd(nowIso());
                        }
                        if (key === "last_30") {
                          setWindowStart(daysAgoIso(30));
                          setWindowEnd(nowIso());
                        }
                      }}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-xs",
                        preset === key
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border bg-[var(--surface2)] text-[var(--text2)]",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                  <div className="ml-auto text-xs text-[var(--text3)]">
                    Last run:{" "}
                    {previewQuery.data?.lastAutopsyAt
                      ? formatPageDate(previewQuery.data.lastAutopsyAt)
                      : "none"}{" "}
                    · {previewQuery.data?.lastAutopsyTradeCount ?? 0} trades
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <label className="text-sm text-[var(--text2)]">
                    Start
                    <Input
                      type="date"
                      value={toDateInput(windowStart)}
                      onChange={(event) => {
                        setPreset("custom");
                        setWindowStart(startOfDayIso(event.target.value));
                      }}
                      className="mt-1 border-border bg-[var(--surface2)] text-[var(--text1)]"
                    />
                  </label>
                  <label className="text-sm text-[var(--text2)]">
                    End
                    <Input
                      type="date"
                      value={toDateInput(windowEnd)}
                      onChange={(event) => {
                        setPreset("custom");
                        setWindowEnd(endOfDayIso(event.target.value));
                      }}
                      className="mt-1 border-border bg-[var(--surface2)] text-[var(--text1)]"
                    />
                  </label>
                  <label className="text-sm text-[var(--text2)]">
                    Broker
                    <select
                      value={filters.brokerAccountIds[0] ?? ""}
                      onChange={(event) =>
                        setFilters((current) => ({
                          ...current,
                          brokerAccountIds: event.target.value
                            ? [event.target.value]
                            : [],
                        }))
                      }
                      className="mt-1 h-10 w-full rounded-md border border-border bg-[var(--surface2)] px-3 text-sm text-[var(--text1)]"
                    >
                      <option value="">All brokers</option>
                      {(brokersData?.brokers ?? []).map((broker) => (
                        <option key={broker.id} value={broker.id}>
                          {broker.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm text-[var(--text2)]">
                    Outcome
                    <select
                      value={filters.outcome}
                      onChange={(event) =>
                        setFilters((current) => ({
                          ...current,
                          outcome: event.target
                            .value as PeriodAutopsyFilters["outcome"],
                        }))
                      }
                      className="mt-1 h-10 w-full rounded-md border border-border bg-[var(--surface2)] px-3 text-sm text-[var(--text1)]"
                    >
                      <option value="all">All</option>
                      <option value="winners">Winners only</option>
                      <option value="losers">Losers only</option>
                    </select>
                  </label>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <div className="mb-2 text-sm text-[var(--text2)]">
                      Instrument class
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {INSTRUMENT_OPTIONS.map((value) => {
                        const active =
                          filters.instrumentClasses.includes(value);
                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() =>
                              setFilters((current) => ({
                                ...current,
                                instrumentClasses: active
                                  ? current.instrumentClasses.filter(
                                      (item) => item !== value,
                                    )
                                  : [...current.instrumentClasses, value],
                              }))
                            }
                            className={cn(
                              "rounded-full border px-3 py-1.5 text-xs capitalize",
                              active
                                ? "border-primary/40 bg-primary/10 text-primary"
                                : "border-border bg-[var(--surface2)] text-[var(--text2)]",
                            )}
                          >
                            {value.replace(/_/g, " ")}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <div className="mb-2 text-sm text-[var(--text2)]">
                      Include agent phases
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {PHASE_OPTIONS.map((value) => {
                        const active =
                          filters.includeAgentPhases.includes(value);
                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() =>
                              setFilters((current) => ({
                                ...current,
                                includeAgentPhases: active
                                  ? current.includeAgentPhases.filter(
                                      (item) => item !== value,
                                    )
                                  : [...current.includeAgentPhases, value],
                              }))
                            }
                            className={cn(
                              "rounded-full border px-3 py-1.5 text-xs capitalize",
                              active
                                ? "border-primary/40 bg-primary/10 text-primary"
                                : "border-border bg-[var(--surface2)] text-[var(--text2)]",
                            )}
                          >
                            {value}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <label className="text-sm text-[var(--text2)]">
                  Min position size (USD)
                  <Input
                    type="number"
                    value={String(filters.minPositionSizeUsd)}
                    onChange={(event) =>
                      setFilters((current) => ({
                        ...current,
                        minPositionSizeUsd: Number(event.target.value || 0),
                      }))
                    }
                    className="mt-1 max-w-[220px] border-border bg-[var(--surface2)] text-[var(--text1)]"
                  />
                </label>
              </div>

              <div className="space-y-3 rounded-xl border border-border bg-[var(--surface2)] px-4 py-4">
                <div className="text-sm font-medium text-[var(--text1)]">
                  Model
                </div>
                <label className="flex items-center gap-2 text-sm text-[var(--text2)]">
                  <input
                    type="checkbox"
                    checked={useWorkspaceDefaultModel}
                    onChange={(event) =>
                      setUseWorkspaceDefaultModel(event.target.checked)
                    }
                  />
                  Use workspace default
                </label>
                <select
                  value={providerKey}
                  disabled={useWorkspaceDefaultModel}
                  onChange={(event) => {
                    setProviderKey(event.target.value);
                    setModelId("");
                  }}
                  className="h-10 w-full rounded-md border border-border bg-[var(--surface)] px-3 text-sm text-[var(--text1)] disabled:opacity-60"
                >
                  <option value="">Select provider</option>
                  {aiProviders.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name}
                    </option>
                  ))}
                </select>
                <select
                  value={modelId}
                  disabled={useWorkspaceDefaultModel || !providerKey}
                  onChange={(event) => setModelId(event.target.value)}
                  className="h-10 w-full rounded-md border border-border bg-[var(--surface)] px-3 text-sm text-[var(--text1)] disabled:opacity-60"
                >
                  <option value="">Select model</option>
                  {(providerModels?.models ?? []).map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </select>
                <div className="text-xs text-[var(--text3)]">
                  {previewQuery.data
                    ? `${previewQuery.data.tradeCount} trades · ~$${previewQuery.data.estimatedCostUsd.toFixed(2)} est.`
                    : "Preview unavailable."}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {andonLessons.length > 0 ? (
          <div className="border-b border-warning-border bg-warning-dim px-6 py-3 text-sm text-warning">
            ⚠ Andon Cord active — {andonLessons.length} recurring failure(s)
            require operator review.{" "}
            <button
              type="button"
              className="font-medium underline"
              onClick={() =>
                andonRef.current?.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                })
              }
            >
              View Details
            </button>
          </div>
        ) : null}

        <div className="mx-auto flex max-w-[1280px] flex-col gap-6 px-6 py-6 xl:flex-row">
          <div className="min-w-0 flex-1 space-y-4">
            {bannerMessage ? (
              <div className="rounded-xl border border-border bg-[var(--surface2)] px-4 py-3 text-sm text-[var(--text2)]">
                {bannerMessage}
              </div>
            ) : null}

            {!selectedAutopsy ? (
              <div className="flex min-h-[360px] flex-col items-center justify-center rounded-[20px] border border-dashed border-border bg-card px-8 text-center">
                <div className="text-4xl opacity-30">⚕</div>
                <div className="mt-4 text-xl font-semibold text-[var(--text1)]">
                  No period autopsy yet for {scopeLabel}.
                </div>
                <div className="mt-2 max-w-[460px] text-sm text-[var(--text3)]">
                  Configure the window above and run your first autopsy.
                </div>
                <Button
                  className="mt-5 px-5"
                  disabled={(previewQuery.data?.tradeCount ?? 0) === 0}
                  onClick={() => void handleRun()}
                >
                  Run Autopsy
                </Button>
              </div>
            ) : parsed ? (
              <>
                <div className="rounded-[14px] border border-border bg-card px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm text-[var(--text2)]">
                        Showing autopsy for{" "}
                        {metaAutopsy?.windowStart.slice(0, 10)} ·{" "}
                        {metaAutopsy?.tradeCount} trades included
                      </div>
                      <div className="mt-1 text-xs text-[var(--text3)]">
                        Model: {metaAutopsy?.modelId} · Generated:{" "}
                        {metaAutopsy
                          ? formatPageDate(metaAutopsy.createdAt)
                          : "—"}
                      </div>
                    </div>
                    <VersionChips
                      autopsies={autopsies}
                      selectedId={selectedAutopsyId}
                      onSelect={setSelectedAutopsyId}
                    />
                  </div>
                </div>

                {selectedAutopsy?.isFallback ? (
                  <div className="rounded-xl border border-warning-border bg-warning-dim px-4 py-3 text-sm text-warning">
                    LLM unavailable — autopsy used fallback summarization.
                  </div>
                ) : null}

                <div className="rounded-[14px] border border-border bg-card px-5 py-5">
                  <div className="mb-2 flex flex-wrap items-center gap-3">
                    <div className="text-2xl font-semibold text-[var(--text1)]">
                      Executive Summary
                    </div>
                    {selectedAutopsy?.qualityGrade ? (
                      <span className="rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">
                        {selectedAutopsy.qualityGrade}
                        {selectedAutopsy.qualityScore != null
                          ? ` · ${selectedAutopsy.qualityScore.toFixed(0)}`
                          : ""}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-sm leading-7 text-[var(--text2)]">
                    {parsed.executiveSummary}
                  </p>
                </div>

                <Section title="Performance & Process Patterns">
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <Metric
                      label="Win rate"
                      value={`${(parsed.performancePatterns.winRate * 100).toFixed(1)}%`}
                    />
                    <Metric
                      label="Winners / Losers / Total"
                      value={`${parsed.performancePatterns.winners} / ${parsed.performancePatterns.losers} / ${parsed.performancePatterns.totalTrades}`}
                    />
                    <Metric
                      label="Avg PnL"
                      value={fmt.usd(parsed.performancePatterns.avgPnlUsd)}
                    />
                    <Metric
                      label="Best PnL"
                      value={fmt.usd(parsed.performancePatterns.bestPnlUsd)}
                    />
                    <Metric
                      label="Worst PnL"
                      value={fmt.usd(parsed.performancePatterns.worstPnlUsd)}
                    />
                    <Metric
                      label="Avg hold"
                      value={fmt.duration(
                        parsed.performancePatterns.avgHoldDurationMs,
                      )}
                    />
                  </div>
                  <div className="mt-4 space-y-3 text-sm text-[var(--text2)]">
                    <div>
                      <span className="font-medium text-[var(--text1)]">
                        Sizing consistency:
                      </span>{" "}
                      {parsed.performancePatterns.sizingConsistency}
                    </div>
                    <div>
                      <span className="font-medium text-[var(--text1)]">
                        Entry timing:
                      </span>{" "}
                      {parsed.performancePatterns.entryTimingPattern}
                    </div>
                    <div>
                      <span className="font-medium text-[var(--text1)]">
                        Regime notes:
                      </span>{" "}
                      {parsed.performancePatterns.regimeNotes}
                    </div>
                  </div>
                </Section>

                <Section title="Recurring Failure Modes">
                  {parsed.recurringFailureModes.length === 0 ? (
                    <div className="text-sm text-[var(--text3)]">
                      No recurring failures detected in this window.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {parsed.recurringFailureModes.map((failure) => (
                        <div
                          key={`${failure.category}-${failure.description}`}
                          className="rounded-xl border border-border bg-[var(--surface2)] px-4 py-3"
                        >
                          <div className="mb-2 flex flex-wrap gap-2">
                            <span className="rounded-full bg-[var(--surface)] px-2 py-1 text-[11px] uppercase text-[var(--text3)]">
                              {failure.category}
                            </span>
                            <span className="rounded-full bg-warning-dim px-2 py-1 text-[11px] text-warning">
                              {failure.count}
                            </span>
                          </div>
                          <div className="text-sm text-[var(--text1)]">
                            {failure.description}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>

                <PeriodLessonsPanel
                  lessons={lessons}
                  currentPeriodAutopsyId={selectedAutopsy?.id ?? null}
                  onStatusChange={async (lessonId, status) => {
                    await api.updatePeriodAutopsyLesson({ lessonId, status });
                    await queryClient.invalidateQueries({
                      queryKey: ["period-autopsy-lessons", scope, sessionId],
                    });
                  }}
                  onAddLesson={async (draft) => {
                    await api.addPeriodAutopsyLesson({
                      scope,
                      sessionId:
                        scope === "session"
                          ? (sessionId ?? undefined)
                          : undefined,
                      lesson: draft.lesson,
                      severity: draft.severity,
                      category: draft.category,
                      proposedFix: draft.proposedFix,
                    });
                    await queryClient.invalidateQueries({
                      queryKey: ["period-autopsy-lessons", scope, sessionId],
                    });
                  }}
                />

                <div ref={andonRef}>
                  <AndonCordCard
                    lessons={andonLessons}
                    onDismiss={async (lessonId) => {
                      await api.updatePeriodAutopsyLesson({
                        lessonId,
                        status: "dismissed",
                      });
                      await queryClient.invalidateQueries({
                        queryKey: ["period-autopsy-lessons", scope, sessionId],
                      });
                    }}
                  />
                </div>

                <Section
                  title={`Included Trades (${includedTrades.length})`}
                  defaultOpen={false}
                >
                  <div className="space-y-3">
                    {includedTrades.map((trade) => (
                      <div
                        key={trade.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-[var(--surface2)] px-4 py-3"
                      >
                        <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--text1)]">
                          <span className="font-mono font-semibold">
                            {trade.instrumentSymbol}
                          </span>
                          <span className="rounded-full bg-[var(--surface)] px-2 py-1 text-[11px] text-[var(--text3)]">
                            {trade.side}
                          </span>
                          <span>{fmt.pnl(trade.final_pnl_usd ?? 0)}</span>
                          <span className="text-[var(--text3)]">
                            {trade.closed_at
                              ? formatPageDate(trade.closed_at)
                              : "—"}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="text-sm font-medium text-primary"
                          onClick={() => onReviewTrade(trade.id)}
                        >
                          Review →
                        </button>
                      </div>
                    ))}
                  </div>
                </Section>
              </>
            ) : (
              <div className="rounded-[14px] border border-border bg-card px-4 py-4 text-sm text-[var(--text2)]">
                Structured results were unavailable for this autopsy version.
              </div>
            )}
          </div>

          <div className="w-full shrink-0 space-y-4 xl:sticky xl:top-24 xl:w-[320px]">
            <div className="rounded-[14px] border border-border bg-card px-4 py-4">
              <div className="mb-3 text-sm font-semibold text-[var(--text1)]">
                Scope Summary
              </div>
              <SidebarRow label="Scope" value={scopeLabel} />
              <SidebarRow
                label="Window"
                value={`${windowStart.slice(0, 10)} → ${windowEnd.slice(0, 10)}`}
              />
              <SidebarRow
                label="Trades"
                value={
                  parsed
                    ? `${parsed.performancePatterns.totalTrades} total · ${parsed.performancePatterns.winners} winners · ${parsed.performancePatterns.losers} losers`
                    : `${selectedAutopsy?.tradeCount ?? 0}`
                }
              />
              <SidebarRow
                label="Net PnL"
                value={
                  parsed
                    ? fmt.usd(
                        parsed.performancePatterns.avgPnlUsd *
                          parsed.performancePatterns.totalTrades,
                      )
                    : "—"
                }
              />
              <SidebarRow
                label="Model"
                value={selectedAutopsy?.modelId ?? "—"}
              />
              <SidebarRow
                label="AI cost"
                value={
                  selectedAutopsy
                    ? fmt.usd(selectedAutopsy.totalCostUsd, 4)
                    : "—"
                }
              />
            </div>

            <div className="rounded-[14px] border border-border bg-card px-4 py-4">
              <div className="mb-3 text-sm font-semibold text-[var(--text1)]">
                Past Autopsies
              </div>
              {autopsies.length === 0 ? (
                <div className="text-sm text-[var(--text3)]">
                  This is the first autopsy for this scope.
                </div>
              ) : (
                <div className="space-y-3">
                  {autopsies.slice(0, 5).map((autopsy) => (
                    <div
                      key={autopsy.id}
                      className="rounded-xl border border-border bg-[var(--surface2)] px-3 py-3"
                    >
                      <div className="text-sm text-[var(--text1)]">
                        {autopsy.windowStart.slice(0, 10)} →{" "}
                        {autopsy.windowEnd.slice(0, 10)}
                      </div>
                      <div className="mt-1 text-xs text-[var(--text3)]">
                        {autopsy.tradeCount} trades · {autopsy.modelId}
                      </div>
                      <button
                        type="button"
                        className="mt-2 text-xs font-medium text-primary"
                        onClick={() => setSelectedAutopsyId(autopsy.id)}
                      >
                        View
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {historyOpen ? (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/40">
          <button
            type="button"
            className="flex-1"
            onClick={() => setHistoryOpen(false)}
          />
          <div className="h-full w-[min(420px,100vw)] overflow-auto border-l border-border bg-card px-5 py-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-lg font-semibold text-[var(--text1)]">
                  Autopsy History — {scopeLabel}
                </div>
              </div>
              <Button
                variant="ghost"
                className="h-8 w-8 p-0"
                onClick={() => setHistoryOpen(false)}
              >
                ×
              </Button>
            </div>
            <div className="space-y-3">
              {autopsies.map((autopsy) => (
                <div
                  key={autopsy.id}
                  className="rounded-xl border border-border bg-[var(--surface2)] px-4 py-4"
                >
                  <div className="text-sm text-[var(--text1)]">
                    {autopsy.windowStart.slice(0, 10)} →{" "}
                    {autopsy.windowEnd.slice(0, 10)}
                  </div>
                  <div className="mt-1 text-xs text-[var(--text3)]">
                    {autopsy.tradeCount} trades · {autopsy.modelId} ·{" "}
                    {formatPageDate(autopsy.createdAt)}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button
                      variant="outline"
                      className="h-8 border-border bg-transparent px-3 text-xs text-[var(--text2)]"
                      onClick={() => {
                        setSelectedAutopsyId(autopsy.id);
                        setHistoryOpen(false);
                      }}
                    >
                      Load
                    </Button>
                    <Button
                      variant="outline"
                      className="h-8 border-border bg-transparent px-3 text-xs text-[var(--text2)]"
                      onClick={() => void handleExport("markdown", autopsy.id)}
                    >
                      Export
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="border-border bg-card">
          <DialogHeader>
            <DialogTitle>
              Estimated cost: $
              {previewQuery.data?.estimatedCostUsd.toFixed(2) ?? "0.00"}.
              Proceed?
            </DialogTitle>
            <DialogDescription>
              This autopsy will analyze {previewQuery.data?.tradeCount ?? 0}{" "}
              trades using the selected model.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="border-border bg-transparent"
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={() => void handleRun(true)}>Run Autopsy</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SidebarRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-2 flex items-start justify-between gap-3 text-sm">
      <div className="text-[var(--text3)]">{label}</div>
      <div className="text-right text-[var(--text1)]">{value}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-[var(--surface2)] px-4 py-3">
      <div className="text-xs uppercase tracking-[0.08em] text-[var(--text3)]">
        {label}
      </div>
      <div className="mt-1 text-sm font-medium text-[var(--text1)]">
        {value}
      </div>
    </div>
  );
}

function safeParsePeriodStructured(json: string) {
  try {
    return JSON.parse(json) as {
      executiveSummary: string;
      performancePatterns: {
        winRate: number;
        totalTrades: number;
        winners: number;
        losers: number;
        avgPnlUsd: number;
        bestPnlUsd: number;
        worstPnlUsd: number;
        avgHoldDurationMs: number;
        sizingConsistency: string;
        entryTimingPattern: string;
        regimeNotes: string;
      };
      recurringFailureModes: Array<{
        category: string;
        count: number;
        description: string;
      }>;
    } & Record<string, unknown>;
  } catch {
    return null;
  }
}
