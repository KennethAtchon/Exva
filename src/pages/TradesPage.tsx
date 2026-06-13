import { useEffect, useMemo, useReducer } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Card, PageShell, ShadcnSelect } from "@/components/custom-ui";
import { Button, Checkbox } from "@/components/ui";
import { WorkspaceContextChip } from "@/components/WorkspaceContextChip";
import { api } from "@/lib/exva";
import { fmt } from "@/lib/formatters";
import { cn } from "@/lib/utils";
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
    <Card className="flex flex-wrap items-end gap-2.5 px-[18px] py-3.5">
      <div className={filterLabelClass}>
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
          className={filterInputClass}
        />
      </div>
      <div className={filterLabelClass}>
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
      <div className={filterLabelClass}>
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
          className={filterInputClass}
        />
      </div>
      {viewMode === "global" ? (
        <div className={filterLabelClass}>
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

const TRADES_TABLE_MIN_WIDTH = 940;

function tradesGridColumns(viewMode: string): string {
  const side = "minmax(88px,auto)";
  const status = "minmax(76px,auto)";
  const action = "minmax(112px,auto)";
  if (viewMode === "global") {
    return `120px 130px ${side} 70px 90px 90px 90px 80px 60px ${status} 60px ${action}`;
  }
  return `130px ${side} 70px 90px 90px 90px 80px 60px ${status} 60px ${action}`;
}

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
  const gridCols = tradesGridColumns(viewMode);

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
      className={tradeRowClass}
      style={{
        gridTemplateColumns: gridCols,
        background: isSelected ? "var(--surface2)" : "transparent",
        minWidth: TRADES_TABLE_MIN_WIDTH,
      }}
    >
      {viewMode === "global" && (
        <span
          className="overflow-hidden text-ellipsis text-[12px] text-[var(--text3)]"
          title={sessionLabel}
        >
          {sessionLabel}
        </span>
      )}
      <div className="flex min-w-0 flex-col">
        <span className="font-mono text-[14px] font-bold text-[var(--text1)]">
          {trade.instrumentSymbol}
        </span>
        {trade.instrumentDisplayName ? (
          <span className="overflow-hidden text-ellipsis text-[12px] text-[var(--text3)]">
            {trade.instrumentDisplayName}
          </span>
        ) : null}
      </div>
      <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
        {trade.predictionOutcome ? (
          <Badge variant="purple" size="sm">
            {trade.predictionOutcome}
          </Badge>
        ) : null}
        <Badge variant={trade.side === "BUY" ? "success" : "danger"} size="sm">
          {trade.side}
        </Badge>
      </div>
      <span className="font-mono text-[12px] text-[var(--text2)]">
        {trade.position_size_usd != null
          ? fmt.usd(trade.position_size_usd, 0)
          : "—"}
      </span>
      <span className="font-mono text-[12px] text-[var(--text2)]">
        {trade.entry_price != null ? fmt.usd(trade.entry_price) : "—"}
      </span>
      <span className="font-mono text-[12px] text-[var(--text2)]">
        {isOpen && trade.current_price != null
          ? fmt.usd(trade.current_price)
          : "—"}
      </span>
      <span
        className={cn(
          "font-mono text-[12px] font-semibold",
          pos ? "text-success" : "text-error",
        )}
      >
        {pnl != null ? fmt.pnl(pnl) : "—"}
      </span>
      <span className="font-mono text-[12px] text-[var(--text3)]">
        {trade.ai_cost_usd != null ? fmt.usd(trade.ai_cost_usd, 3) : "—"}
      </span>
      <span className="font-mono text-[12px] text-[var(--text2)]">
        {trade.confidence_score != null
          ? `${Math.round(trade.confidence_score * 100)}%`
          : "—"}
      </span>
      <div className="min-w-0">
        <Badge variant={isOpen ? "success" : "default"} size="sm">
          {trade.status}
        </Badge>
      </div>
      <span className="font-mono text-[12px] text-[var(--text3)]">
        {trade.opened_at ? fmt.time(trade.opened_at) : "—"}
      </span>
      {!isOpen && onViewAutopsy && (
        <div className="min-w-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onViewAutopsy(trade.id);
            }}
            className={autopsyButtonClass}
            title="Review trade"
          >
            ⚕ Review Trade
          </button>
        </div>
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

  const gridCols = tradesGridColumns(viewMode);

  return (
    <PageShell>
      <div>
        <h1 className="m-0 text-[22px] font-semibold text-[var(--text1)]">
          Trades
        </h1>
        <p className="mt-1 text-[13px] text-[var(--text3)]">
          All trade history and open positions
        </p>
      </div>
      <div className="flex items-center justify-between gap-2.5">
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
          <div className="flex items-center gap-2 text-[12px] text-[var(--text2)]">
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

      <div className="flex gap-3.5">
        {[
          [
            "Realized P&L",
            fmt.pnl(realPnl),
            realPnl >= 0 ? "text-success" : "text-error",
          ],
          [
            "Win Rate",
            closed.length
              ? `${Math.round((wins.length / closed.length) * 100)}%`
              : "—",
            "text-[var(--text1)]",
          ],
          ["Total Trades", `${allTrades.length}`, "text-[var(--text1)]"],
          [
            "Open",
            `${allTrades.filter((t) => t.status === "open").length}`,
            "text-info",
          ],
        ].map(([lbl, val, colorClass]) => (
          <Card key={String(lbl)} className="flex-1 px-[22px] py-[18px]">
            <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--text3)]">
              {lbl}
            </div>
            <div
              className={cn(
                "font-mono text-[26px] font-bold leading-none",
                colorClass,
              )}
            >
              {val}
            </div>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden !p-0">
        <div className="flex gap-1.5 border-b border-[var(--border)] px-5 py-4">
          {(["all", "open", "closed"] as Filter[]).map((s) => (
            <Button
              key={s}
              onClick={() => dispatchFilter({ type: "setFilter", filter: s })}
              variant="ghost"
              className={cn(
                filterTabButtonClass,
                filter === s
                  ? "border border-[var(--border)] bg-[var(--surface3)] text-[var(--text1)]"
                  : "border border-transparent bg-transparent text-[var(--text3)]",
              )}
            >
              {s}
            </Button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <div
            className={tradeTableHeaderClass}
            style={{
              gridTemplateColumns: gridCols,
              minWidth: TRADES_TABLE_MIN_WIDTH,
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

const filterTabButtonClass =
  "cursor-pointer rounded-[7px] px-[14px] py-[5px] font-sans text-[12px]";

const tradeTableHeaderClass =
  "grid border-b border-[var(--border)] px-5 pb-2 pt-2.5 text-[12px] font-semibold uppercase tracking-[0.07em] text-[var(--text3)]";

const tradeRowClass =
  "grid cursor-pointer items-center border-b border-[var(--border)] px-5 py-[11px] transition-[background] duration-100";

const autopsyButtonClass =
  "inline-flex max-w-full min-w-0 cursor-pointer items-center overflow-hidden whitespace-nowrap rounded-[5px] border border-[var(--border)] bg-transparent px-2 py-[3px] font-mono text-[12px] tracking-[0.03em] text-[var(--text3)]";

const filterLabelClass =
  "flex flex-col gap-1.5 text-[12px] uppercase tracking-[0.06em] text-[var(--text3)]";

const filterInputClass =
  "min-w-[120px] rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-2.5 py-[7px] font-sans text-[13px] text-[var(--text1)]";
