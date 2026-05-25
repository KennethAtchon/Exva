import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Card, PageShell, ShadcnSelect } from "@/components/custom-ui";
import { Button, Checkbox } from "@/components/ui";
import { WorkspaceContextChip } from "@/components/WorkspaceContextChip";
import { api } from "@/lib/exva";
import { fmt } from "@/lib/formatters";
import type { ExecutionMode, InstrumentClass } from "@/lib/types";
import { useTradeStore } from "@/store/tradeStore";
import { useWorkspaceStore } from "@/store/workspaceStore";

type Filter = "all" | "open" | "closed";

export const TradesPage = ({
  onViewAutopsy,
}: {
  onViewAutopsy?: (tradeId: string) => void;
} = {}) => {
  const [filter, setFilter] = useState<Filter>("all");
  const [symbolContains, setSymbolContains] = useState("");
  const [instrumentType, setInstrumentType] = useState<"" | InstrumentClass>(
    "",
  );
  const [brokerAccountId, setBrokerAccountId] = useState("");
  const [sessionFilterId, setSessionFilterId] = useState("");

  const viewMode = useWorkspaceStore((state) => state.viewMode);
  const focusedSessionId = useWorkspaceStore((state) => state.focusedSessionId);
  const preferences = useWorkspaceStore((state) => state.preferences);
  const environmentMode = useWorkspaceStore((state) => state.environmentMode);
  const setViewMode = useWorkspaceStore((state) => state.setViewMode);
  const loadWorkspaceView = useWorkspaceStore(
    (state) => state.loadWorkspaceView,
  );
  const allTrades = useTradeStore((s) => s.trades);
  const setTrades = useTradeStore((s) => s.setTrades);
  const selectedId = useTradeStore((s) => s.selectedId);
  const setSelected = useTradeStore((s) => s.setSelected);

  const apiFilters = useMemo(() => {
    const f: {
      sessionId?: string;
      brokerAccountId?: string;
      symbolContains?: string;
      instrumentType?: InstrumentClass;
      executionMode?: ExecutionMode;
    } = {};
    if (viewMode === "global" && sessionFilterId) f.sessionId = sessionFilterId;
    if (brokerAccountId.trim()) f.brokerAccountId = brokerAccountId.trim();
    if (symbolContains.trim()) f.symbolContains = symbolContains.trim();
    if (instrumentType) f.instrumentType = instrumentType;
    f.executionMode = environmentMode === "live" ? "live_allowed" : "paper_only";
    return f;
  }, [
    viewMode,
    sessionFilterId,
    brokerAccountId,
    symbolContains,
    instrumentType,
    environmentMode,
  ]);

  const executionModeFilter =
    environmentMode === "live" ? "live_allowed" : "paper_only";

  const { data: sessionsData } = useQuery({
    queryKey: [
      "trades-session-options",
      preferences?.globalIncludeArchived,
      environmentMode,
      executionModeFilter,
    ],
    queryFn: () =>
      api.listSessions({
        includeArchived: preferences?.globalIncludeArchived,
        executionMode: executionModeFilter,
      }),
  });
  const sessionOptions =
    sessionsData?.sessions.map((s) => ({ id: s.id, name: s.name })) ?? [];

  useEffect(() => {
    setSessionFilterId("");
  }, [environmentMode]);

  useEffect(() => {
    void api
      .getActiveTrades(Object.keys(apiFilters).length ? apiFilters : undefined)
      .then(setTrades)
      .catch(() => {});
  }, [apiFilters, setTrades, viewMode, focusedSessionId]);

  const trades = allTrades.filter(
    (t) => filter === "all" || t.status === filter,
  );
  const closed = allTrades.filter((t) => t.status === "closed");
  const wins = closed.filter((t) => (t.final_pnl_usd ?? 0) > 0);
  const realPnl = closed.reduce((s, t) => s + (t.final_pnl_usd ?? 0), 0);

  return (
    <PageShell>
      <div>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: "var(--text1)",
            margin: 0,
          }}
        >
          Trades
        </h1>
        <p style={{ fontSize: 13, color: "var(--text3)", marginTop: 4 }}>
          All trade history and open positions
        </p>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 10,
        }}
      >
        <WorkspaceContextChip
          onSwitchSession={async (id) => {
            await api.focusSession(id);
            await loadWorkspaceView();
          }}
          onGoGlobal={async () => {
            await api.goGlobal();
            setViewMode("global", null);
          }}
        />
        {viewMode === "global" && (
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              color: "var(--text2)",
              fontSize: 12,
            }}
          >
            <Checkbox
              checked={preferences?.globalIncludeArchived ?? false}
              onCheckedChange={async (checked) => {
                await api.patchWorkspacePreferences({
                  globalIncludeArchived: checked === true,
                });
                await loadWorkspaceView();
              }}
            />
            Include archived sessions
          </label>
        )}
      </div>

      <Card
        style={{
          padding: "14px 18px",
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          alignItems: "flex-end",
        }}
      >
        <label style={filterLabelStyle}>
          Symbol
          <input
            value={symbolContains}
            onChange={(e) => setSymbolContains(e.target.value)}
            placeholder="e.g. AAPL"
            style={filterInputStyle}
          />
        </label>
        <label style={filterLabelStyle}>
          Class
          <ShadcnSelect
            value={instrumentType}
            onValueChange={(value) =>
              setInstrumentType(value as "" | InstrumentClass)
            }
            className="min-w-[120px]"
            options={[
              { value: "", label: "Any" },
              { value: "stock", label: "Stock" },
              { value: "crypto", label: "Crypto" },
              { value: "futures", label: "Futures" },
            ]}
          />
        </label>
        <label style={filterLabelStyle}>
          Broker account id
          <input
            value={brokerAccountId}
            onChange={(e) => setBrokerAccountId(e.target.value)}
            placeholder="UUID"
            style={filterInputStyle}
          />
        </label>
        {viewMode === "global" ? (
          <label style={filterLabelStyle}>
            Session
            <ShadcnSelect
              value={sessionFilterId}
              onValueChange={setSessionFilterId}
              className="min-w-[180px]"
              options={[
                { value: "", label: "All sessions" },
                ...sessionOptions.map((session) => ({
                  value: session.id,
                  label: session.name,
                })),
              ]}
            />
          </label>
        ) : null}
      </Card>

      <div style={{ display: "flex", gap: 14 }}>
        {[
          [
            "Realized P&L",
            fmt.pnl(realPnl),
            realPnl >= 0 ? "#34d399" : "#f87171",
          ],
          [
            "Win Rate",
            closed.length
              ? `${Math.round((wins.length / closed.length) * 100)}%`
              : "—",
            "var(--text1)",
          ],
          ["Total Trades", `${allTrades.length}`, "var(--text1)"],
          [
            "Open",
            `${allTrades.filter((t) => t.status === "open").length}`,
            "#60a5fa",
          ],
        ].map(([lbl, val, color]) => (
          <Card key={String(lbl)} style={{ flex: 1, padding: "18px 22px" }}>
            <div
              style={{
                fontSize: 11,
                color: "var(--text3)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: 8,
                fontWeight: 600,
              }}
            >
              {lbl}
            </div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 26,
                fontWeight: 700,
                color,
                lineHeight: 1,
              }}
            >
              {val}
            </div>
          </Card>
        ))}
      </div>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div
          style={{
            display: "flex",
            gap: 6,
            padding: "16px 20px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          {(["all", "open", "closed"] as Filter[]).map((s) => (
            <Button
              key={s}
              onClick={() => setFilter(s)}
              variant="ghost"
              style={{
                padding: "5px 14px",
                fontSize: 12,
                borderRadius: 7,
                cursor: "pointer",
                background: filter === s ? "var(--surface3)" : "transparent",
                border: `1px solid ${filter === s ? "var(--border)" : "transparent"}`,
                color: filter === s ? "var(--text1)" : "var(--text3)",
                fontFamily: "var(--font-sans)",
              }}
            >
              {s}
            </Button>
          ))}
        </div>
        <div style={{ overflowX: "auto" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                viewMode === "global"
                  ? "120px 130px 60px 70px 90px 90px 90px 80px 60px 55px 60px 70px"
                  : "130px 60px 70px 90px 90px 90px 80px 60px 55px 60px 70px",
              padding: "10px 20px 8px",
              fontSize: 10,
              color: "var(--text3)",
              textTransform: "uppercase",
              letterSpacing: "0.07em",
              fontWeight: 600,
              borderBottom: "1px solid var(--border)",
              minWidth: 860,
            }}
          >
            {[
              ...(viewMode === "global" ? ["Session"] : []),
              "Instrument",
              "Side",
              "Size",
              "Entry",
              "Cur/Exit",
              "P&L",
              "AI Cost",
              "Conf",
              "Status",
              "Time",
              "",
            ].map((h) => (
              <span key={h}>{h}</span>
            ))}
          </div>
          {trades.map((t) => {
            const isOpen = t.status === "open";
            const pnl = (isOpen ? t.unrealized_pnl : t.final_pnl_usd) ?? null;
            const pos = pnl != null && pnl >= 0;
            const sessionLabel = t.sessionName ?? t.sessionId ?? "—";
            return (
              <div
                key={t.id}
                onClick={() => setSelected(t.id === selectedId ? null : t.id)}
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    viewMode === "global"
                      ? "120px 130px 60px 70px 90px 90px 90px 80px 60px 55px 60px 70px"
                      : "130px 60px 70px 90px 90px 90px 80px 60px 55px 60px 70px",
                  padding: "11px 20px",
                  alignItems: "center",
                  cursor: "pointer",
                  borderBottom: "1px solid var(--border)",
                  background:
                    t.id === selectedId ? "var(--surface2)" : "transparent",
                  transition: "background 0.1s",
                  minWidth: 860,
                }}
              >
                {viewMode === "global" && (
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--text3)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    title={sessionLabel}
                  >
                    {sessionLabel}
                  </span>
                )}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 14,
                      fontWeight: 700,
                      color: "var(--text1)",
                    }}
                  >
                    {t.instrumentSymbol}
                  </span>
                  {t.instrumentDisplayName ? (
                    <span
                      style={{
                        fontSize: 11,
                        color: "var(--text3)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {t.instrumentDisplayName}
                    </span>
                  ) : null}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {t.predictionOutcome ? (
                    <Badge variant="purple" size="sm">
                      {t.predictionOutcome}
                    </Badge>
                  ) : null}
                  <Badge
                    variant={t.side === "BUY" ? "success" : "danger"}
                    size="sm"
                  >
                    {t.side}
                  </Badge>
                </div>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    color: "var(--text2)",
                  }}
                >
                  {fmt.usd(t.position_size_usd, 0)}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    color: "var(--text2)",
                  }}
                >
                  {t.entry_price != null ? fmt.usd(t.entry_price) : "—"}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    color: "var(--text2)",
                  }}
                >
                  {isOpen && t.current_price != null
                    ? fmt.usd(t.current_price)
                    : "—"}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    color: pos ? "#34d399" : "#f87171",
                    fontWeight: 600,
                  }}
                >
                  {pnl != null ? fmt.pnl(pnl) : "—"}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--text3)",
                  }}
                >
                  {fmt.usd(t.ai_cost_usd, 3)}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    color: "var(--text2)",
                  }}
                >
                  {t.confidence_score != null
                    ? `${Math.round(t.confidence_score * 100)}%`
                    : "—"}
                </span>
                <Badge variant={isOpen ? "success" : "default"} size="sm">
                  {t.status}
                </Badge>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--text3)",
                  }}
                >
                  {t.opened_at ? fmt.time(t.opened_at) : "—"}
                </span>
                {!isOpen && onViewAutopsy && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onViewAutopsy(t.id);
                    }}
                    style={{
                      padding: "3px 8px",
                      borderRadius: 5,
                      border: "1px solid var(--border)",
                      background: "transparent",
                      color: "var(--text3)",
                      fontSize: 10,
                      cursor: "pointer",
                      fontFamily: "var(--font-mono)",
                      letterSpacing: "0.03em",
                      whiteSpace: "nowrap",
                    }}
                    title="View autopsy"
                  >
                    ⚕ Autopsy
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </PageShell>
  );
};

const filterLabelStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 6,
  fontSize: 11,
  color: "var(--text3)",
  textTransform: "uppercase" as const,
  letterSpacing: "0.06em",
};
const filterInputStyle = {
  minWidth: 120,
  padding: "7px 10px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--surface2)",
  color: "var(--text1)",
  fontSize: 13,
  fontFamily: "var(--font-sans)",
};
