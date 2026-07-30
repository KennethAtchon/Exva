import { z } from "zod";
import { defineCapability } from "./capability";
import { CONFIRM_CLASS, sessionRefSchema } from "./capabilities-shared";
import { resolveSession } from "./resolve-session";
import { formatOneDayAcceptanceReport } from "../analytics/one-day-acceptance-report-service";

/**
 * Operator diagnostics for the "why did nothing trade?" question, plus the
 * paper order-path certification tap (Solution 01 / 05 / 06 WS4).
 */

export const getScanFunnel = defineCapability<{ session: string }>({
  key: "get_scan_funnel",
  label: "Get scan funnel",
  kind: "read",
  description:
    "Why a scheduled session's last scan produced no decision: per-instrument outcome counts " +
    "(signal, no_setup, insufficient_bars, input_stale, bars_failed, evaluate_failed, empty_universe), " +
    "the first blocked instrument, and schedule health. Only signal/no_setup mean the strategy actually " +
    "evaluated; the rest are data or configuration defects, not market opinions.",
  inputSchema: sessionRefSchema,
  describe: (input) => `Read the scan funnel for session "${input.session}".`,
  execute: (input, services) => {
    const session = resolveSession(services, input.session);
    return services.scanFunnel.forSession(session.id);
  },
});

export const getOpportunityRate = defineCapability<{
  session: string;
  day?: string;
}>({
  key: "get_opportunity_rate",
  label: "Get opportunity rate",
  kind: "read",
  description:
    "How many fair chances a session actually got on a given day: eligible evaluations (de-duplicated " +
    "by bar window), repeat looks, setups, setup rate, and the share blocked by insufficient history. " +
    "A low setup rate with a high blocked-by-history rate means the lane was starved, not selective.",
  inputSchema: z.object({
    session: z
      .string()
      .min(1)
      .describe("Session id or name (partial name allowed)."),
    day: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("UTC day key, YYYY-MM-DD. Defaults to today."),
  }),
  describe: (input) =>
    `Read opportunity rate for session "${input.session}" on ${input.day ?? "today"}.`,
  execute: (input, services) => {
    const session = resolveSession(services, input.session);
    const day = input.day ?? new Date().toISOString().slice(0, 10);
    return {
      sessionId: session.id,
      day,
      ...services.opportunityRate.summarize(session.id, day),
    };
  },
});

export const runPaperCertification = defineCapability<{
  session: string;
  brokerAccountId: string;
}>({
  key: "run_paper_certification",
  label: "Run paper certification",
  kind: "mutating",
  confirmClass: CONFIRM_CLASS.tradeExecution,
  // Places a real (paper) order. Never auto-approve, even within a
  // conversation that pre-approved other trade actions.
  alwaysConfirm: true,
  description:
    "Arm one $10 SPY paper certification round trip to prove the Exva-to-broker order path: durable " +
    "order intents, correlated client/broker order IDs, partial-fill persistence, exit sizing from the " +
    "actual filled quantity, and flat reconciliation. Paper only; rejects live workspace, live session, " +
    "live broker, engaged kill switch, and closed regular-hours market. Infrastructure proof only — the " +
    "resulting trade carries originKind=certification and is excluded from alpha metrics. Capped at one " +
    "completed run per broker account per UTC day.",
  inputSchema: z.object({
    session: z
      .string()
      .min(1)
      .describe("Session id or name (partial name allowed). Must be paper_only."),
    brokerAccountId: z
      .string()
      .min(1)
      .describe("Paper Alpaca broker account id to certify."),
  }),
  describe: (input) =>
    `Arm a $10 SPY paper certification round trip on "${input.session}" via broker ${input.brokerAccountId}.`,
  affectedEntity: (input) => `session:${input.session}`,
  risk: (input, services) => {
    const account = services.repos.brokerAccounts
      .list()
      .find((b) => b.id === input.brokerAccountId);
    return {
      level: account?.mode === "live" ? "live" : "normal",
      note:
        `Places one real $10 SPY order on ${account?.name ?? input.brokerAccountId} ` +
        `(${account?.mode ?? "unknown"} mode) and closes it automatically.`,
    };
  },
  execute: async (input, services) => {
    const session = resolveSession(services, input.session);
    const svc = services.paperCertification;
    if (!svc) throw new Error("Paper certification service is not configured");
    return svc.arm({
      sessionId: session.id,
      brokerAccountId: input.brokerAccountId,
    });
  },
});

export const getPaperCertification = defineCapability<{ runId: string }>({
  key: "get_paper_certification",
  label: "Get paper certification run",
  kind: "read",
  description:
    "Read one paper certification run: status, entry/exit client and broker order IDs, filled quantity, " +
    "and failure code. States advance armed → submitting_entry → entry_open → entry_filled → " +
    "submitting_exit → exit_open → closed.",
  inputSchema: z.object({
    runId: z.string().min(1).describe("Certification run id returned by arm."),
  }),
  describe: (input) => `Read paper certification run ${input.runId}.`,
  execute: (input, services) => {
    const svc = services.paperCertification;
    if (!svc) throw new Error("Paper certification service is not configured");
    return svc.get(input.runId);
  },
});

export const runAdapterCertificationCap = defineCapability<{
  brokerAccountId: string;
}>({
  key: "run_adapter_certification",
  label: "Run adapter certification",
  kind: "mutating",
  confirmClass: CONFIRM_CLASS.tradeExecution,
  alwaysConfirm: true,
  description:
    "Run the full adapter certification harness (auth→account→data→place→fill→close→restart) " +
    "against a stored broker account and persist the result.",
  inputSchema: z.object({
    brokerAccountId: z.string().min(1),
  }),
  describe: (input) =>
    `Run adapter certification for broker account ${input.brokerAccountId}.`,
  execute: async (input, services) =>
    services.adapterCertification.runForAccount(input.brokerAccountId),
});

export const getAdapterCertification = defineCapability<{
  brokerAccountId: string;
}>({
  key: "get_adapter_certification",
  label: "Get adapter certification",
  kind: "read",
  description: "Read the latest persisted adapter certification for a broker account.",
  inputSchema: z.object({
    brokerAccountId: z.string().min(1),
  }),
  describe: (input) =>
    `Read latest adapter certification for ${input.brokerAccountId}.`,
  execute: (input, services) =>
    services.adapterCertification.getLatest(input.brokerAccountId),
});

export const getOneDayAcceptanceReport = defineCapability<{
  session: string;
  day?: string;
}>({
  key: "get_one_day_acceptance_report",
  label: "Get one-day acceptance report",
  kind: "read",
  description:
    "Assemble the one-day acceptance report: uptime first, setup rate (refused below 90% coverage), " +
    "certification IDs, fresh-input counts, bars vs min, AI failures, EDGAR funnel, Polymarket catch-up, orders/fills.",
  inputSchema: z.object({
    session: z.string().min(1),
    day: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  }),
  describe: (input) =>
    `Generate one-day acceptance report for session "${input.session}" on ${input.day ?? "today"}.`,
  execute: (input, services) => {
    const session = resolveSession(services, input.session);
    const report = services.oneDayAcceptanceReport.generate(
      session.id,
      input.day,
    );
    return {
      report,
      formatted: formatOneDayAcceptanceReport(report),
    };
  },
});
