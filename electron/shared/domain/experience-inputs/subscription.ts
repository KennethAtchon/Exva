import type { TradingTimeframe } from "@electron/shared/domain/enums";
import type { CadenceSpec } from "./cadence";

// ---------------------------------------------------------------------------
// Resolved session input subscription (discriminated by mode)
// ---------------------------------------------------------------------------

/**
 * A session's concrete, pinned runtime input configuration.
 *
 * The `mode` field is the discriminant. Both variants carry common identity
 * and lifecycle fields; the mode-specific payload differs.
 */
export type SessionInputSubscription =
  | EventSourceSubscription
  | ScheduledScanSubscription;

interface SubscriptionBase {
  id: string;
  sessionId: string;
  templateId: string;
  templateVersion: number;
  enabled: boolean;
  createdFromProfileId: string | null;
  /** Monotonically incremented on each mutation of this subscription row. */
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface EventSourceSubscription extends SubscriptionBase {
  mode: "event_source";
  sourceDefinitionId: string;
  sourceRevision: number;
  /** Serialized filter object; empty `{}` means "accept all". */
  filtersJson: string;
  analysisTimeframe: TradingTimeframe;
}

export interface ScheduledScanSubscription extends SubscriptionBase {
  mode: "scheduled_scan";
  instrumentSetId: string;
  instrumentSetRevision: number;
  /** Canonical JSON of the CadenceSpec (produced by serializeCadenceCanonical). */
  cadenceJson: string;
  analysisTimeframe: TradingTimeframe;
  marketCalendarId: string;
  /** Serialized strategy parameter object. */
  strategyParametersJson: string;
}

// ---------------------------------------------------------------------------
// Draft shapes (pre-persistence, no id/sessionId/timestamps)
// ---------------------------------------------------------------------------

export type SessionInputSubscriptionDraft =
  | EventSourceSubscriptionDraft
  | ScheduledScanSubscriptionDraft;

export interface EventSourceSubscriptionDraft {
  mode: "event_source";
  templateId: string;
  templateVersion: number;
  sourceDefinitionId: string;
  sourceRevision: number;
  filters: Record<string, unknown>;
  analysisTimeframe: TradingTimeframe;
  /** Profile this draft was copied from, if any. */
  createdFromProfileId?: string | null;
}

export interface ScheduledScanSubscriptionDraft {
  mode: "scheduled_scan";
  templateId: string;
  templateVersion: number;
  instrumentSetId: string;
  instrumentSetRevision: number;
  cadence: CadenceSpec;
  analysisTimeframe: TradingTimeframe;
  marketCalendarId: string;
  strategyParameters: Record<string, unknown>;
  createdFromProfileId?: string | null;
}

// ---------------------------------------------------------------------------
// Session input configuration (aggregate for a session)
// ---------------------------------------------------------------------------

/**
 * The complete resolved input configuration for a session, returned by
 * `ExperienceConfigurationApi.replaceSessionInputs` and similar reads.
 */
export interface SessionInputConfiguration {
  sessionId: string;
  /**
   * Monotonically incremented each time the subscription set is replaced.
   * Used for optimistic concurrency on writes.
   */
  inputRevision: number;
  subscriptions: SessionInputSubscription[];
}
