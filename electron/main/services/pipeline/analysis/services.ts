import type { AIPhaseServices } from "../phases/services";
import type { InstrumentNormalizer } from "../../broker/instrument-normalizer";
import type { StatsRepo } from "../../../db/repositories/system/stats-repo";
import type { SessionRepo } from "../../../db/repositories/sessions/session-repo";
import type { TradesRepo } from "../../../db/repositories/trades/trades-repo";
import type { DecisionTraceRepo } from "../../../db/repositories/trades/decision-trace-repo";
import type { ExperienceCapitalAllocator } from "../../risk/experience-capital-allocator";
import type { CalendarEventsRepo } from "../../../db/repositories/signals/calendar-events-repo";

export interface InstrumentAnalysisServices extends AIPhaseServices {
  statsRepo: StatsRepo;
  sessionRepo: SessionRepo;
  tradesRepo: TradesRepo;
  decisionTracesRepo: DecisionTraceRepo;
  instrumentNormalizer: InstrumentNormalizer;
  experienceCapitalAllocator?: ExperienceCapitalAllocator;
  /** Optional — used by risk-gate calendar blackout. */
  calendarEventsRepo?: CalendarEventsRepo;
}
