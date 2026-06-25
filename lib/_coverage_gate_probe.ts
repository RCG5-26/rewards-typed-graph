/**
 * DO NOT MERGE — coverage-gate validation probe only.
 * Branch: chore/validate-coverage-gate-fail → feat/tdd-enforcement
 * Purpose: prove CI coverage-gate fails when new lines lack tests.
 */
export function coverageGateValidationProbe(): string {
  return "untested-on-purpose";
}
