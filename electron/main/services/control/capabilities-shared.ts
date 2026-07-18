import { z } from "zod";

export const CONFIRM_CLASS = {
  sessionLifecycle: "session_lifecycle",
  strategyWrite: "strategy_write",
  signalWrite: "signal_write",
  tradeExecution: "trade_execution",
  autopsy: "autopsy",
  templateWrite: "template_write",
  backtest: "backtest",
  brokerOps: "broker_ops",
  dataDoctor: "data_doctor",
} as const;

export const OPEN_TRADE_STATUSES = new Set(["open", "pending"]);

export const sessionRefSchema = z.object({
  session: z
    .string()
    .min(1)
    .describe("Session id or name (partial name allowed)."),
});

export const emptyInputSchema = z.object({}).strict() as unknown as z.ZodType<
  Record<string, never>
>;
