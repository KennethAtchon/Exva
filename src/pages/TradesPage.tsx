import { useEffect, useMemo, useReducer } from "react";
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

type FilterState = {
  filter: Filter;
  symbolContains: string;
  instrumentType: "" | InstrumentClass;
  brokerAccountId: string;
  sessionFilterId: string;
};

type FilterAction =
  | { type: "setFilter"; filter: Filter }
  | { type: "setSymbolContains"; symbolContains: string }
  | { type: "setInstrumentType"; instrumentType: "" | InstrumentClass }
  | { type: "setBrokerAccountId"; brokerAccountId: string }
  | { type: "setSessionFilterId"; sessionFilterId: string };

const initialFilterState: FilterState = {
  filter: "all",
  symbolContains: "",
  instrumentType: "",
  brokerAccountId: "",
  sessionFilterId: "",
};

function filterReducer(state: FilterState, action: FilterAction): FilterState {
  switch (action.type) {
    case "setFilter":
      return { ...state, filter: action.filter };
    case "setSymbolContains":
      return { ...state, symbolContains: action.symbolContains };
    case "setInstrumentType":
      return { ...state, instrumentType: action.instrumentType };
    case "setBrokerAccountId":
      return { ...state, brokerAccountId: action.brokerAccountId };
    case "setSessionFilterId":
      return { ...state, sessionFilterId: action.sessionFilterId };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Trade type (minimal shape from store)
// ---------------------------------------------------------------------------

type Trade = {
  id: string;
  status: string;
  sessionName?: string | null;
  sessionId?: string | null;
  instrumentSymbol: string;
  instrumentDisplayName?: string | null;
  predictionOutcome?: string | null;
  side: string;
  position_size_usd?: number | null;
  entry_price?: number | null;
  current_price?: number | null;
  unrealized_pnl?: number | null;
  final_pnl_usd?: number | null;
  ai_cost_usd?: number | null;
  confidence_score?: number | null;
  opened_at?: string | null;
};

// ---------------------------------------------------------------------------
// TradeFilters
// ---------------------------------------------------------------------------

const TradeFilters = ({
  filterState,
  viewMode,
  sessionOptions,
  dispatch,
}: {
  filterState: FilterState;
  viewMode: string;
  sessionOptions: { id: string; name: string }[];
  dispatch: (action: FilterAction) => void;
}) => {
  const { symbolContains, instrumentType, brokerAccountId, sessionFilterId } =
    filterState;
  return (
    <Card
      style={{
        padding: "14px 18px",
        display: "flex",
        flexWrap: "wrap",
        gap: 10,
        alignItems: "flex-end",
      }}
    >
      <div style={filterLabelStyle}>
        Symbol
        <input
          value={symbolContains}
          onChange={(e) =>
            dispatch({
              type: "setSymbolContains",
              symbolContains: e.target.value,
            })
          }
          placeholder="e.g. AAPL"
          style={filterInputStyle}
        />
      </div>
      <div style={filterLabelStyle}>
        Class
        <ShadcnSelect
          value={instrumentType}
          onValueChange={(value) =>
            dispatch({
              type: "setInstrumentType",
              instrumentType: value as "" | InstrumentClass,
            })
          }
          className="min-w-[120px]"
          options={[
            { value: "", label: "Any" },
            { value: "stock", label: "Stock" },
            { value: "crypto", label: "Crypto" },
            { value: "futures", label: "Futures" },
          ]}
        />
      </div>
      <div style={filterLabelStyle}>
        Broker account id
        <input
          value={brokerAccountId}
          onChange={(e) =>
            dispatch({
              type: "setBrokerAccountId",
              brokerAccountId: e.target.value,
            })
          }
          placeholder="UUID"
          style={filterInputStyle}
        />
      </div>
      {viewMode === "global" ? (
        <div style={filterLabelStyle}>
          Session
          <ShadcnSelect
            value={sessionFilterId}
            onValueChange={(value) =>
              dispatch({
                type: "setSessionFilterId",
                sessionFilterId: value,
              })
            }
            className="min-w-[180px]"
            options={[
              { value: "", label: "All sessions" },
              ...sessionOptions.map((session) => ({
                value: session.id,
                label: session.name,
              })),
            ]}
          />
        </div>
      ) : null}
    </Card>
  );
};

// ---------------------------------------------------------------------------
// TradeRow
// ---------------------------------------------------------------------------

const TradeRow = ({
  trade,
  isSelected,
  viewMode,
  onSelect,
  onViewAutopsy,
}: {
  trade: Trade;
  isSelected: boolean;
  viewMode: string;
  onSelect: (id: string) => void;
  onViewAutopsy?: (id: string) => void;
}) => {
  const isOpen = trade.status === "open";
  const pnl = (isOpen ? trade.unrealized_pnl : trade.final_pnl_usd) ?? null;
  const pos = pnl != null && pnl >= 0;
  const sessionLabel = trade.sessionName ?? trade.sessionId ?? "—";
  const gridCols =
    viewMode === "global"
      ? "120px 130px 60px 70px 90px 90px 90px 80px 60px 55px 60px 70px"
      : "130px 60px 70px 90px 90px 90px 80px 60px 55px 60px 70px";

  return (
    <div
      key={trade.id}
      onClick={() => onSelect(trade.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(trade.id);
        }
      }}
      style={{
        ...tradeRowStyle,
        gridTemplateColumns: gridCols,
        background: isSelected ? "var(--surface2)" : "transparent",
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
          {trade.instrumentSymbol}
        </span>
        {trade.instrumentDisplayName ? (
          <span
            style={{
              fontSize: 12,
              color: "var(--text3)",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {trade.instrumentDisplayName}
          </span>
        ) : null}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {trade.predictionOutcome ? (
          <Badge variant="purple" size="sm">
            {trade.predictionOutcome}
          </Badge>
        ) : null}
        <Badge variant={trade.side === "BUY" ? "success" : "danger"} size="sm">
          {trade.side}
        </Badge>
      </div>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: "var(--text2)",
        }}
      >
        {trade.position_size_usd != null
          ? fmt.usd(trade.position_size_usd, 0)
          : "—"}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: "var(--text2)",
        }}
      >
        {trade.entry_price != null ? fmt.usd(trade.entry_price) : "—"}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: "var(--text2)",
        }}
      >
        {isOpen && trade.current_price != null
          ? fmt.usd(trade.current_price)
          : "—"}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: pos ? "var(--color-success)" : "var(--color-error)",
          fontWeight: 600,
        }}
      >
        {pnl != null ? fmt.pnl(pnl) : "—"}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: "var(--text3)",
        }}
      >
        {trade.ai_cost_usd != null ? fmt.usd(trade.ai_cost_usd, 3) : "—"}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: "var(--text2)",
        }}
      >
        {trade.confidence_score != null
          ? `${Math.round(trade.confidence_score * 100)}%`
          : "—"}
      </span>
      <Badge variant={isOpen ? "success" : "default"} size="sm">
        {trade.status}
      </Badge>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: "var(--text3)",
        }}
      >
        {trade.opened_at ? fmt.time(trade.opened_at) : "—"}
      </span>
      {!isOpen && onViewAutopsy && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onViewAutopsy(trade.id);
          }}
          style={autopsyButtonStyle}
          title="View autopsy"
        >
          ⚕ Autopsy
        </button>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// TradesPage
// ---------------------------------------------------------------------------

export const TradesPage = ({
  onViewAutopsy,
}: {
  onViewAutopsy?: (tradeId: string) => void;
} = {}) => {
  const [filterState, dispatchFilter] = useReducer(
    filterReducer,
    initialFilterState,
  );
  const {
    filter,
    symbolContains,
    instrumentType,
    brokerAccountId,
    sessionFilterId,
  } = filterState;

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
    f.executionMode =
      environmentMode === "live" ? "live_allowed" : "paper_only";
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

  const gridCols =
    viewMode === "global"
      ? "120px 130px 60px 70px 90px 90px 90px 80px 60px 55px 60px 70px"
      : "130px 60px 70px 90px 90px 90px 80px 60px 55px 60px 70px";

  return (
    <PageShell>
      <div>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 600,
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
          <div
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
          </div>
        )}
      </div>

      <TradeFilters
        filterState={filterState}
        viewMode={viewMode}
        sessionOptions={sessionOptions}
        dispatch={dispatchFilter}
      />

      <div style={{ display: "flex", gap: 14 }}>
        {[
          [
            "Realized P&L",
            fmt.pnl(realPnl),
            realPnl >= 0 ? "var(--color-success)" : "var(--color-error)",
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
            "var(--color-info)",
          ],
        ].map(([lbl, val, color]) => (
          <Card key={String(lbl)} style={{ flex: 1, padding: "18px 22px" }}>
            <div
              style={{
                fontSize: 12,
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
              onClick={() => dispatchFilter({ type: "setFilter", filter: s })}
              variant="ghost"
              style={{
                ...filterTabButtonStyle,
                background: filter === s ? "var(--surface3)" : "transparent",
                border: `1px solid ${filter === s ? "var(--border)" : "transparent"}`,
                color: filter === s ? "var(--text1)" : "var(--text3)",
              }}
            >
              {s}
            </Button>
          ))}
        </div>
        <div style={{ overflowX: "auto" }}>
          <div
            style={{
              ...tradeTableHeaderStyle,
              gridTemplateColumns: gridCols,
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
          {trades.map((t) => (
            <TradeRow
              key={t.id}
              trade={t}
              isSelected={t.id === selectedId}
              viewMode={viewMode}
              onSelect={(id) => setSelected(id === selectedId ? null : id)}
              onViewAutopsy={onViewAutopsy}
            />
          ))}
        </div>
      </Card>
    </PageShell>
  );
};

const filterTabButtonStyle = {
  padding: "5px 14px",
  fontSize: 12,
  borderRadius: 7,
  cursor: "pointer",
  fontFamily: "var(--font-sans)",
} as const;

const tradeTableHeaderStyle = {
  display: "grid",
  padding: "10px 20px 8px",
  fontSize: 12,
  color: "var(--text3)",
  textTransform: "uppercase",
  letterSpacing: "0.07em",
  fontWeight: 600,
  borderBottom: "1px solid var(--border)",
} as const;

const tradeRowStyle = {
  display: "grid",
  padding: "11px 20px",
  alignItems: "center",
  cursor: "pointer",
  borderBottom: "1px solid var(--border)",
  transition: "background 0.1s",
} as const;

const autopsyButtonStyle = {
  padding: "3px 8px",
  borderRadius: 5,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text3)",
  fontSize: 12,
  cursor: "pointer",
  fontFamily: "var(--font-mono)",
  letterSpacing: "0.03em",
  whiteSpace: "nowrap" as const,
} as const;

const filterLabelStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 6,
  fontSize: 12,
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
