import { describe, expect, it } from "vitest";
import {
  DEFAULT_SELECTOR_FORCE_SUBMIT_AFTER_STEP,
  DEFAULT_SELECTOR_MAX_DISCOVERY_STEPS,
  DEFAULT_SELECTOR_MAX_NO_NEW_INFO_STEPS,
  DEFAULT_SELECTOR_MAX_REPEATED_SYMBOL_CHECKS,
  DEFAULT_SELECTOR_MAX_VERIFICATION_STEPS,
  DEFAULT_SELECTOR_MIN_CANDIDATES_BEFORE_VERIFICATION,
  resolveSelectorRoleSettings,
} from "../ai/ai-role-profile";
import { createDefaultAiRoleProfileDocument } from "../ai/default-ai-role-profiles";

describe("selector role profile settings", () => {
  it("resolves selector runtime defaults from the default instrument selector profile", () => {
    const profile = createDefaultAiRoleProfileDocument("instrument_selector");
    const resolved = resolveSelectorRoleSettings(profile);

    expect(resolved).toMatchObject({
      maxDiscoverySteps: DEFAULT_SELECTOR_MAX_DISCOVERY_STEPS,
      maxVerificationSteps: DEFAULT_SELECTOR_MAX_VERIFICATION_STEPS,
      maxNoNewInfoSteps: DEFAULT_SELECTOR_MAX_NO_NEW_INFO_STEPS,
      maxRepeatedSymbolChecks: DEFAULT_SELECTOR_MAX_REPEATED_SYMBOL_CHECKS,
      minCandidatesBeforeVerification: DEFAULT_SELECTOR_MIN_CANDIDATES_BEFORE_VERIFICATION,
      forceSubmitAfterStep: DEFAULT_SELECTOR_FORCE_SUBMIT_AFTER_STEP,
    });
  });

  it("falls back to defaults when selector settings are missing or invalid", () => {
    const resolved = resolveSelectorRoleSettings({
      version: 1,
      objective: "x",
      constraints: [],
      toolPolicy: {},
      method: { checklist: [], requiredEvidence: [], avoid: [] },
      output: { requiredSections: [] },
      selectorSettings: {
        maxDiscoverySteps: 0,
        maxVerificationSteps: 999,
        maxNoNewInfoSteps: -1,
        maxRepeatedSymbolChecks: 0,
        minCandidatesBeforeVerification: 0,
        forceSubmitAfterStep: 999,
      },
    });

    expect(resolved.maxDiscoverySteps).toBe(DEFAULT_SELECTOR_MAX_DISCOVERY_STEPS);
    expect(resolved.maxVerificationSteps).toBe(DEFAULT_SELECTOR_MAX_VERIFICATION_STEPS);
    expect(resolved.maxNoNewInfoSteps).toBe(DEFAULT_SELECTOR_MAX_NO_NEW_INFO_STEPS);
    expect(resolved.maxRepeatedSymbolChecks).toBe(DEFAULT_SELECTOR_MAX_REPEATED_SYMBOL_CHECKS);
    expect(resolved.minCandidatesBeforeVerification).toBe(DEFAULT_SELECTOR_MIN_CANDIDATES_BEFORE_VERIFICATION);
    expect(resolved.forceSubmitAfterStep).toBe(DEFAULT_SELECTOR_FORCE_SUBMIT_AFTER_STEP);
  });
});
