/**
 * Ordered provider/model routes per worker role (Solution 07 WS2).
 * At most one fallback hop per cycle.
 */

export type RoutePurpose = "primary" | "fallback" | "repair";

export interface WorkerRouteHop {
  providerType: string;
  modelId: string;
  purpose: RoutePurpose;
}

export interface WorkerRoute {
  role: string;
  routes: WorkerRouteHop[];
}

/** Default routes for structured-output-heavy roles. */
const DEFAULT_ROUTES: Record<string, WorkerRouteHop[]> = {
  forecast: [
    {
      providerType: "anthropic",
      modelId: "claude-sonnet-4-20250514",
      purpose: "primary",
    },
    { providerType: "openai", modelId: "gpt-4o", purpose: "fallback" },
  ],
  decision: [
    {
      providerType: "anthropic",
      modelId: "claude-sonnet-4-20250514",
      purpose: "primary",
    },
    { providerType: "openai", modelId: "gpt-4o", purpose: "fallback" },
  ],
  fundamental: [
    {
      providerType: "anthropic",
      modelId: "claude-sonnet-4-20250514",
      purpose: "primary",
    },
    { providerType: "openai", modelId: "gpt-4o", purpose: "fallback" },
  ],
  review: [
    {
      providerType: "anthropic",
      modelId: "claude-sonnet-4-20250514",
      purpose: "primary",
    },
    { providerType: "openai", modelId: "gpt-4o", purpose: "fallback" },
  ],
};

export function resolveWorkerRoutes(
  role: string,
  configured?: WorkerRouteHop[] | null,
): WorkerRouteHop[] {
  if (configured && configured.length > 0) return configured;
  return (
    DEFAULT_ROUTES[role] ?? [
      {
        providerType: "anthropic",
        modelId: "claude-sonnet-4-20250514",
        purpose: "primary",
      },
    ]
  );
}

/**
 * Pick the next hop after a transport/schema failure.
 * Returns null when no unused fallback remains (at most one fallback hop).
 */
export function nextFallbackHop(
  routes: WorkerRouteHop[],
  failedProviderType: string,
  failedModelId: string,
): WorkerRouteHop | null {
  const failedIdx = routes.findIndex(
    (r) =>
      r.providerType === failedProviderType && r.modelId === failedModelId,
  );
  const start = failedIdx >= 0 ? failedIdx + 1 : 0;
  for (let i = start; i < routes.length; i += 1) {
    const hop = routes[i];
    if (hop?.purpose === "fallback" || hop?.purpose === "repair") {
      return hop;
    }
  }
  return null;
}
