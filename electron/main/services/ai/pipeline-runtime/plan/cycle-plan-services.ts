import type { PhasePlanServices } from "./phase-plan-services";
import type { InstrumentNormalizer } from "../../../broker/instrument-normalizer";
import type { StatsRepo } from "../../../../db/repositories/system/stats-repo";
import type { SessionRepo } from "../../../../db/repositories/sessions/session-repo";

export interface CyclePlanServices extends PhasePlanServices {
  statsRepo: StatsRepo;
  sessionRepo: SessionRepo;
  instrumentNormalizer: InstrumentNormalizer;
}
