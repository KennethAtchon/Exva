import {
  CATALYST_ANALYST_WORKER,
  CATALYST_FUNDAMENTAL_WORKERS,
  STANDARD_FUNDAMENTAL_WORKERS,
} from "./definitions/fundamental.phase";
import { DECISION_WORKERS } from "./definitions/decision.phase";
import {
  ADVERSARIAL_REVIEWER_WORKER,
  REVIEW_WORKERS,
} from "./definitions/review.phase";
import {
  CATALYST_SELECTOR_DISCOVERY,
  EVENT_SELECTOR_DISCOVERY,
  STANDARD_SELECTOR_DISCOVERY,
} from "./definitions/selector.phase";
import { CATALYST_TECHNICAL_WORKERS } from "./definitions/technical.phase";
import { registerWorkers } from "./worker-registry";

let registered = false;

export function registerAllPipelineWorkers(): void {
  if (registered) return;
  registered = true;
  registerWorkers(CATALYST_SELECTOR_DISCOVERY);
  registerWorkers(STANDARD_SELECTOR_DISCOVERY);
  registerWorkers(EVENT_SELECTOR_DISCOVERY);
  registerWorkers(CATALYST_TECHNICAL_WORKERS);
  registerWorkers(CATALYST_FUNDAMENTAL_WORKERS);
  registerWorkers(STANDARD_FUNDAMENTAL_WORKERS);
  registerWorkers(REVIEW_WORKERS);
  registerWorkers(DECISION_WORKERS);
  registerWorkers([CATALYST_ANALYST_WORKER, ADVERSARIAL_REVIEWER_WORKER]);
}
