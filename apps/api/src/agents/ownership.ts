import type { SpecialistAgentType } from "./contracts";
import type { SpecialistMutationKind } from "./contracts";

export const MUTATION_OWNERSHIP: Readonly<
  Record<SpecialistAgentType, ReadonlyArray<SpecialistMutationKind>>
> = {
  wallet_agent: ["UpdateUserBalance"],
  earning_agent: [],
  redemption_agent: ["CreatePlanStep", "RecordStateDependency"],
} as const;

export function isOwnedBy(agentType: SpecialistAgentType, kind: SpecialistMutationKind): boolean {
  return MUTATION_OWNERSHIP[agentType].includes(kind);
}
