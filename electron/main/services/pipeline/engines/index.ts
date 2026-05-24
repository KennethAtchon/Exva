// Selector-specific engines: input, entry-mode, and cache engines that are
// shared infrastructure for the selector phase. These must be registered
// centrally because selector.phase.ts cannot import its own finalizer engines
// (selector-risk-filter imports SelectorPlanState from selector.phase.ts —
// importing back would create a circular dependency).
//
// Aggregator finalizer engines (technical, fundamental, review, decision) are
// registered by their respective phase definition files via side-effect imports.
import "./input/selector-scope";
import "./input/broker-coverage";
import "./input/prediction-market-candidates";
import "./entry-mode/manual-shortlist";
import "./cache/selector-instrument-cache";
import "./finalizer/selector-risk-filter";
import "./finalizer/selector-submission-builder";
