import { describe, expect, it } from "vitest";
import {
  nextFallbackHop,
  resolveWorkerRoutes,
} from "../worker-route-resolver";

describe("worker-route-resolver", () => {
  it("returns structured-output defaults for forecast", () => {
    const routes = resolveWorkerRoutes("forecast");
    expect(routes[0]?.purpose).toBe("primary");
    expect(routes.some((r) => r.purpose === "fallback")).toBe(true);
  });

  it("allows at most one fallback hop after the failed primary", () => {
    const routes = resolveWorkerRoutes("decision");
    const primary = routes[0]!;
    const hop = nextFallbackHop(routes, primary.providerType, primary.modelId);
    expect(hop?.purpose).toBe("fallback");
    const second = nextFallbackHop(
      routes,
      hop!.providerType,
      hop!.modelId,
    );
    expect(second).toBeNull();
  });
});
