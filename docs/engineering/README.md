# Engineering Docs

Cross-cutting engineering standards and operational guides for Exva.

## Start by Task

| Job                                    | Start here                                         | Then use                                                                                |
| -------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Debug a failure                        | [Debugging Guide](./debugging-guide.md)            | [Observability Contract](./observability-guide.md), [Logging Guide](./logging-guide.md) |
| Decide whether a failure is observable | [Observability Contract](./observability-guide.md) | Its failure matrix and gap register                                                     |
| Add or change telemetry                | [Observability Contract](./observability-guide.md) | [Logging Guide](./logging-guide.md), [Coding Guidelines](./CODING_GUIDELINES.md)        |
| Validate a code change                 | [QA Guide](./project-qa-guide.md)                  | [E2E Testing Guide](./e2e-testing-guide.md)                                             |
| Write or review code                   | [Coding Guidelines](./CODING_GUIDELINES.md)        | Domain specs under `docs/specs/`                                                        |

## Authority and Truth

`observability-guide.md` is authoritative for telemetry fields, correlation,
evidence bundles, failure coverage, and known observability gaps.
`logging-guide.md` owns log safety and event-shape rules.
`debugging-guide.md` owns the investigation procedure.

Engineering docs distinguish verified current behavior from target behavior:

- **Implemented:** present in code and verified by a test.
- **Partial:** evidence exists but is insufficient for deterministic diagnosis.
- **Required:** contract requirement not implemented yet.
- **Unknown:** not verified; treat as absent.

Documentation is not evidence that instrumentation exists. When a guide conflicts
with code or a test, code and tests describe current behavior and the document must
be corrected.

## Maintenance Rule

Any change to an async boundary, process, scheduler, provider, broker, cache,
persistent workflow, or debug export updates the observability contract and its
failure-injection coverage in the same change. Do not keep undated known-failure
lists in evergreen guides; link to a dated issue or CI run instead.
