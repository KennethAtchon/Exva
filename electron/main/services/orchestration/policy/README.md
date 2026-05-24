# orchestration/policy

Holds deterministic checks that block bad trades before they hit a broker. These rules are local TypeScript logic, not AI judgment.

## Technical

- `candidate-validation-service.ts` checks whether a selector candidate is even eligible to continue.
- `order-policy-gate.ts` is the last gate before order placement.
- Policy code is reused from both selector filtering and live trade execution.

## Terms

- **Policy gate** — deterministic rule set that can allow, warn, or block a trade path.
