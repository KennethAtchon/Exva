import { z } from "zod";

/**
 * Channels with no request body. Invokers may pass `undefined`, `null`, or `{}`.
 */
export const ipcNoPayloadSchema = z
  .union([z.undefined(), z.null(), z.object({}).strict()])
  .transform(() => undefined);

/**
 * Last-resort schema for non-money channels not yet given a dedicated Zod
 * contract. Prefer a real schema — do not use this on trading/money paths.
 */
export const ipcPayloadUnknownSchema = z.unknown();
