import { z } from "zod";

export const rendererDiagnosticSchema = z
  .object({
    kind: z.enum([
      "error",
      "unhandled_rejection",
      "react_error_boundary",
      "bootstrap_error",
    ]),
    eventId: z.string().uuid(),
    occurredAt: z.string().datetime(),
    name: z.string().max(100).optional(),
    message: z.string().max(1000),
    stack: z.string().max(8000).optional(),
    componentStack: z.string().max(8000).optional(),
    route: z.string().max(500).optional(),
  })
  .strict();

export type RendererDiagnostic = z.infer<typeof rendererDiagnosticSchema>;
