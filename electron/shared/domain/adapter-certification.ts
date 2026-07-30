import { z } from "zod";

export const certCheckResultSchema = z.object({
  name: z.string(),
  ok: z.boolean(),
  detail: z.string(),
});

export const adapterCertReportSchema = z.object({
  brokerType: z.string(),
  mode: z.enum(["mock", "live-keys"]),
  passed: z.boolean(),
  checks: z.array(certCheckResultSchema),
});

export type CertCheckResult = z.infer<typeof certCheckResultSchema>;
export type AdapterCertReport = z.infer<typeof adapterCertReportSchema>;

export interface BrokerAdapterCertState {
  brokerAccountId: string;
  certRunId: string;
  brokerType: string;
  mode: "mock" | "live-keys";
  passed: boolean;
  checks: CertCheckResult[];
  certifiedAt: string;
  updatedAt: string;
}

/** Cert results older than this are stale for live launch. */
export const ADAPTER_CERT_MAX_AGE_MS = 30 * 24 * 60 * 60_000;

export function adapterCertIsFresh(certifiedAt: string, now = Date.now()): boolean {
  const age = now - Date.parse(certifiedAt);
  return Number.isFinite(age) && age >= 0 && age <= ADAPTER_CERT_MAX_AGE_MS;
}
