import type {
  PollResult,
  SignalEvent,
  SignalSourceRuntimeStatus,
  SignalSourceType,
} from "@electron/shared/domain";

export interface SignalSourceActivityEntry {
  at: string;
  kind: "ok" | "error" | "drop";
  summary: string;
}

export interface SignalSourceSnapshot {
  lastPollAt: string | null;
  lastPollResult: PollResult | null;
  lastSignalAt: string | null;
  lastSignalTicker: string | null;
  recentActivity: SignalSourceActivityEntry[];
}

export interface ISignalSource {
  readonly id: string;
  readonly type: SignalSourceType;
  readonly status: SignalSourceRuntimeStatus;
  readonly lastError: string | null;
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(newConfig: Record<string, unknown>): Promise<void>;
  test(): Promise<PollResult>;
  snapshot(): SignalSourceSnapshot;
  onSignal(handler: (event: SignalEvent) => void): void;
  offSignal(handler: (event: SignalEvent) => void): void;
}
