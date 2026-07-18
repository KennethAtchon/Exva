import { useEffect, useMemo, useReducer, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Card, ShadcnSelect } from "@/components/custom-ui";
import {
  Button,
  Checkbox,
  HelpTooltip,
  Input,
  PnL,
  StatTile,
} from "@/components/ui";
import { VirtualList } from "@/components/hub/VirtualList";
import { api } from "@/lib/exva";
import { formatIpcError } from "@/lib/ipc-error";
import { formatPercent } from "@/lib/format";
import { fmt } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import type { ExecutionMode, InstrumentClass } from "@/lib/types";
import { useTradeStore } from "@/store/tradeStore";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { PanelLoading } from "@/components/ui/skeleton";
import { HubEmptyState, HubQueryError } from "@/hubs/dna";

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
  embedded = false,
}: {
  filterState: FilterState;
  viewMode: string;
  sessionOptions: { id: string; name: string }[];
  dispatch: (action: FilterAction) => void;
  embedded?: boolean;
}) => {
  const {
    filter,
    symbolContains,
    instrumentType,
    brokerAccountId,
    sessionFilterId,
  } = filterState;

  const activeChips: Array<{
    id: string;
    label: string;
    onClear?: () => void;
  }> = [];
  if (symbolContains.trim()) {
    activeChips.push({
      id: "symbol",
      label: `Symbol: ${symbolContains.trim()}`,
      onClear: () =>
        dispatch({ type: "setSymbolContains", symbolContains: "" }),
    });
  }
  if (instrumentType) {
    activeChips.push({
      id: "class",
      label: `Class: ${instrumentType}`,
      onClear: () =>
        dispatch({ type: "setInstrumentType", instrumentType: "" }),
    });
  }
  if (brokerAccountId.trim()) {
    activeChips.push({
      id: "broker",
      label: "Broker filter",
      onClear: () =>
        dispatch({ type: "setBrokerAccountId", brokerAccountId: "" }),
    });
  }
  if (viewMode === "global" && sessionFilterId) {
    const sessionName =
      sessionOptions.find((s) => s.id === sessionFilterId)?.name ?? "Session";
    activeChips.push({
      id: "session",
      label: sessionName,
      onClear: () =>
        dispatch({ type: "setSessionFilterId", sessionFilterId: "" }),
    });
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-2 border-b border-border bg-surface px-4 py-3",
        !embedded && "rounded-sm border border-border",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {(["all", "open", "closed"] as Filter[]).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={filter === value ? "secondary" : "ghost"}
            onClick={() => dispatch({ type: "setFilter", filter: value })}
            className="capitalize"
          >
            {value}
          </Button>
        ))}
        <ShadcnSelect
          value={instrumentType}
          onValueChange={(value) =>
            dispatch({
              type: "setInstrumentType",
              instrumentType: value as "" | InstrumentClass,
            })
          }
          className="w-28"
          options={[
            { value: "", label: "Any class" },
            { value: "stock", label: "Stock" },
            { value: "crypto", label: "Crypto" },
            { value: "futures", label: "Futures" },
          ]}
        />
        {viewMode === "global" ? (
          <ShadcnSelect
            value={sessionFilterId}
            onValueChange={(value) =>
              dispatch({ type: "setSessionFilterId", sessionFilterId: value })
            }
            className="min-w-36"
            options={[
              { value: "", label: "All sessions" },
              ...sessionOptions.map((session) => ({
                value: session.id,
                label: session.name,
              })),
            ]}
          />
        ) : null}
        <Input
          value={symbolContains}
          onChange={(e) =>
            dispatch({
              type: "setSymbolContains",
              symbolContains: e.target.value,
            })
          }
          placeholder="Symbol"
          className="w-28"
        />
        <Input
          value={brokerAccountId}
          onChange={(e) =>
            dispatch({
              type: "setBrokerAccountId",
              brokerAccountId: e.target.value,
            })
          }
          placeholder="Broker id"
          className="w-32"
        />
      </div>
      {activeChips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {activeChips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={chip.onClear}
              className="inline-flex items-center gap-1 rounded-sm border border-border bg-surface2 px-2 py-0.5 font-mono text-micro text-text2 hover:bg-surface3"
            >
              {chip.label}
              <span className="text-text3">×</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};

const TRADES_TABLE_MIN_WIDTH = 940;

function tradesGridColumns(viewMode: string): string {
  const side = "minmax(88px,auto)";
  const status = "minmax(76px,auto)";
  const confidence = "minmax(88px,auto)";
  const action = "minmax(112px,auto)";
  if (viewMode === "global") {
    return `120px 130px ${side} 70px 90px 90px 90px 80px ${confidence} ${status} 60px ${action}`;
  }
  return `130px ${side} 70px 90px 90px 90px 80px ${confidence} ${status} 60px ${action}`;
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
        <span className="truncate font-sans text-caption text-text3">
          {sessionLabel}
        </span>
      )}
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-mono text-data text-text1">
          {trade.instrumentSymbol}
        </span>
        {trade.instrumentDisplayName ? (
          <span className="truncate font-sans text-caption text-text3">
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
      <span className="font-mono text-data tabular-nums text-text2">
        {trade.position_size_usd != null
          ? fmt.usd(trade.position_size_usd, 0)
          : "—"}
      </span>
      <span className="font-mono text-data tabular-nums text-text2">
        {trade.entry_price != null ? fmt.usd(trade.entry_price) : "—"}
      </span>
      <span className="font-mono text-data tabular-nums text-text2">
        {isOpen && trade.current_price != null
          ? fmt.usd(trade.current_price)
          : "—"}
      </span>
      <PnL value={pnl} />
      <span className="font-mono text-data tabular-nums text-text3">
        {trade.ai_cost_usd != null ? fmt.usd(trade.ai_cost_usd, 3) : "—"}
      </span>
      <span className="font-mono text-data tabular-nums text-text2">
        {trade.confidence_score != null
          ? `${Math.round(trade.confidence_score * 100)}%`
          : "—"}
      </span>
      <div className="min-w-0">
        <Badge variant={isOpen ? "success" : "default"} size="sm">
          {trade.status}
        </Badge>
      </div>
      <span className="font-mono text-caption text-text3">
        {trade.opened_at ? fmt.time(trade.opened_at) : "—"}
      </span>
      {!isOpen && onViewAutopsy && (
        <div className="min-w-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onViewAutopsy(trade.id);
            }}
          >
            Review
          </Button>
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
  embedded = false,
}: {
  onViewAutopsy?: (tradeId: string) => void;
  embedded?: boolean;
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
  const loadWorkspaceView = useWorkspaceStore(
    (state) => state.loadWorkspaceView,
  );
  const allTrades = useTradeStore((s) => s.trades);
  const setTrades = useTradeStore((s) => s.setTrades);
  const selectedId = useTradeStore((s) => s.selectedId);
  const setSelected = useTradeStore((s) => s.setSelected);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(allTrades.length === 0);

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
    setLoading(true);
    void api
      .getActiveTrades(Object.keys(apiFilters).length ? apiFilters : undefined)
      .then((rows) => {
        setTrades(rows);
        setLoadError(null);
      })
      .catch((err) => {
        setLoadError(formatIpcError(err).display);
      })
      .finally(() => setLoading(false));
  }, [apiFilters, setTrades, viewMode, focusedSessionId]);

  const trades = allTrades.filter(
    (t) => filter === "all" || t.status === filter,
  );
  const closed = allTrades.filter((t) => t.status === "closed");
  const wins = closed.filter((t) => (t.final_pnl_usd ?? 0) > 0);
  const realPnl = closed.reduce((s, t) => s + (t.final_pnl_usd ?? 0), 0);

  const gridCols = tradesGridColumns(viewMode);

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col",
        !embedded && "hub-panel-body gap-5",
      )}
    >
      {!embedded ? (
        <div>
          <h1 className="m-0 font-sans text-head text-text1">Trades</h1>
          <p className="mt-1 font-sans text-body text-text2">
            All trade history and open positions
          </p>
          <div className="mt-2">
            <HelpTooltip
              topic="Trades page scope"
              body={
                viewMode === "global"
                  ? "Global mode shows trades across sessions in the current environment."
                  : "Focused mode shows trades for the currently focused session."
              }
            />
          </div>
        </div>
      ) : null}

      {!embedded && viewMode === "global" ? (
        <div className="flex items-center gap-2 font-sans text-caption text-text2">
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
      ) : null}

      <TradeFilters
        filterState={filterState}
        viewMode={viewMode}
        sessionOptions={sessionOptions}
        dispatch={dispatchFilter}
        embedded={embedded}
      />

      <div
        className={cn(
          "grid gap-3 px-4 py-3",
          embedded
            ? "grid-cols-2 sm:grid-cols-4"
            : "grid-cols-2 sm:grid-cols-4",
        )}
      >
        <StatTile
          label="Realized P&L"
          value={<PnL value={realPnl} size="stat" />}
        />
        <StatTile
          label="Win rate"
          value={
            closed.length ? formatPercent(wins.length / closed.length, 0) : "—"
          }
        />
        <StatTile label="Total trades" value={String(allTrades.length)} />
        <StatTile
          label="Open"
          value={String(allTrades.filter((t) => t.status === "open").length)}
        />
      </div>

      <Card className="mx-4 mb-4 flex min-h-0 flex-1 flex-col overflow-hidden !p-0">
        <div className={tradeTableScrollClass}>
          <div
            className={tradeTableHeaderClass}
            style={{
              gridTemplateColumns: gridCols,
              minWidth: TRADES_TABLE_MIN_WIDTH,
            }}
          >
            {viewMode === "global" ? <span>Session</span> : null}
            <span>Instrument</span>
            <span>Side</span>
            <span>Size</span>
            <span>Entry</span>
            <span>Cur/Exit</span>
            <HelpTooltip glossaryId="daily-pnl" topic="Trade P&L">
              <span>P&amp;L</span>
            </HelpTooltip>
            <HelpTooltip glossaryId="ai-cost" topic="Trade AI cost">
              <span>AI cost</span>
            </HelpTooltip>
            <HelpTooltip glossaryId="confidence" topic="Trade confidence">
              <span>Confidence</span>
            </HelpTooltip>
            <span>Status</span>
            <span>Time</span>
            <span />
          </div>
          <div
            className={cn(
              tradeTableBodyScrollClass,
              embedded && "min-h-0 flex-1",
            )}
          >
            {loadError ? (
              <HubQueryError
                message={loadError}
                onRetry={() => {
                  setLoading(true);
                  void api
                    .getActiveTrades(
                      Object.keys(apiFilters).length ? apiFilters : undefined,
                    )
                    .then((rows) => {
                      setTrades(rows);
                      setLoadError(null);
                    })
                    .catch((err) => {
                      setLoadError(formatIpcError(err).display);
                    })
                    .finally(() => setLoading(false));
                }}
                className="m-2"
              />
            ) : loading && trades.length === 0 ? (
              <PanelLoading />
            ) : (
              <VirtualList
                items={trades}
                rowHeight={48}
                className="h-full min-h-48"
                getKey={(t) => t.id}
                renderRow={(t) => (
                  <TradeRow
                    trade={t}
                    isSelected={t.id === selectedId}
                    viewMode={viewMode}
                    onSelect={(id) =>
                      setSelected(id === selectedId ? null : id)
                    }
                    onViewAutopsy={onViewAutopsy}
                  />
                )}
                empty={
                  <HubEmptyState
                    title="No trades yet"
                    body="Start a paper session from an experience — fills and closes show up here."
                    className="py-8"
                  />
                }
              />
            )}
          </div>
        </div>
      </Card>
    </div>
  );
};

const tradeTableHeaderClass =
  "grid border-b border-border px-4 pb-2 pt-2 font-mono text-micro uppercase tracking-wider text-text3";

const tradeRowClass =
  "grid cursor-pointer items-center border-b border-border px-4 py-2 transition-colors duration-hover hover:bg-surface2";

const tradeTableScrollClass = "flex min-h-0 flex-1 flex-col overflow-x-auto";

const tradeTableBodyScrollClass = "overflow-y-auto [scrollbar-gutter:stable]";
