/**
 * Shared commit validation and ownership enforcement (M7).
 *
 * This module is the SINGLE authority for pre-commit checks. Both the
 * in-memory test double (InMemoryAgentCommitFactory) and the production
 * ControlledGraphWriteCommit import from here — the two can never drift.
 */

import { isOwnedBy } from "../ownership";
import type {
  AgentCommitBinding,
  AgentCommitInput,
  CreatePlanStepMutation,
  ReadSet,
  SpecialistMutation,
  SpecialistMutationKind,
} from "../contracts";
import { CommitFailure } from "../contracts";

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function stableFingerprint(mutation: SpecialistMutation): string {
  return JSON.stringify(mutation, (_, val: unknown) =>
    val !== null && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort())
      : val,
  );
}

export function validateReadSet(readSet: ReadSet): void {
  for (const [nodeId, version] of Object.entries(readSet)) {
    if (!isNonEmptyString(nodeId)) {
      throw new CommitFailure("ValidationError", "readSet contains empty node id");
    }
    if (!Number.isInteger(version) || version < 0) {
      throw new CommitFailure("ValidationError", `invalid readSet version for ${nodeId}`);
    }
  }
}

function validateCreatePlanStep(mutation: CreatePlanStepMutation): void {
  if (!isNonEmptyString(mutation.planId)) {
    throw new CommitFailure("ValidationError", "CreatePlanStep requires planId");
  }
  if (!Number.isInteger(mutation.stepOrder) || mutation.stepOrder < 1) {
    throw new CommitFailure("ValidationError", "CreatePlanStep requires stepOrder >= 1");
  }
  switch (mutation.stepType) {
    case "card_assignment":
      if (!isNonEmptyString(mutation.payload.cardId)) {
        throw new CommitFailure("ValidationError", "card_assignment requires cardId");
      }
      break;
    case "spend_analysis":
      if (
        !isNonEmptyString(mutation.payload.spendCategoryId) ||
        !isNonEmptyString(mutation.payload.recommendedCardId)
      ) {
        throw new CommitFailure(
          "ValidationError",
          "spend_analysis requires spendCategoryId and recommendedCardId",
        );
      }
      break;
    case "redemption_recommendation":
      if (
        !isNonEmptyString(mutation.payload.redemptionOptionId) ||
        !isNonEmptyString(mutation.payload.sourceProgramId)
      ) {
        throw new CommitFailure(
          "ValidationError",
          "redemption_recommendation requires redemptionOptionId and sourceProgramId",
        );
      }
      break;
    case "transfer_recommendation":
      if (
        !isNonEmptyString(mutation.payload.fromProgramId) ||
        !isNonEmptyString(mutation.payload.toProgramId)
      ) {
        throw new CommitFailure(
          "ValidationError",
          "transfer_recommendation requires fromProgramId and toProgramId",
        );
      }
      break;
    default: {
      const _exhaustive: never = mutation;
      throw new CommitFailure(
        "ValidationError",
        `unknown stepType: ${(_exhaustive as CreatePlanStepMutation).stepType}`,
      );
    }
  }
}

export function validateMutationStructure(mutation: SpecialistMutation): void {
  const knownKinds: readonly SpecialistMutationKind[] = [
    "UpdateUserBalance",
    "CreatePlanStep",
    "RecordStateDependency",
  ];
  if (!knownKinds.includes(mutation.kind)) {
    throw new CommitFailure(
      "ValidationError",
      `unknown mutation kind: ${(mutation as { kind: string }).kind}`,
    );
  }

  switch (mutation.kind) {
    case "UpdateUserBalance":
      if (!isNonEmptyString(mutation.balanceNodeId)) {
        throw new CommitFailure("ValidationError", "UpdateUserBalance requires balanceNodeId");
      }
      break;
    case "CreatePlanStep":
      validateCreatePlanStep(mutation);
      break;
    case "RecordStateDependency":
      if (
        !isNonEmptyString(mutation.planStepId) ||
        !isNonEmptyString(mutation.targetNodeId) ||
        !Number.isInteger(mutation.observedVersion) ||
        mutation.observedVersion < 0
      ) {
        throw new CommitFailure(
          "ValidationError",
          "RecordStateDependency requires planStepId, targetNodeId, observedVersion",
        );
      }
      if (
        mutation.target.targetNodeType !== "UserBalance" &&
        mutation.target.targetNodeType !== "UserProgramStatus"
      ) {
        throw new CommitFailure("ValidationError", "unknown StateDependencyTarget variant");
      }
      break;
    default: {
      const _exhaustive: never = mutation;
      throw new CommitFailure(
        "ValidationError",
        `unhandled mutation: ${(_exhaustive as SpecialistMutation).kind}`,
      );
    }
  }
}

/**
 * Run all pre-commit checks in the order specified by Contract 4:
 *  1. idempotencyKey non-empty
 *  2. readSet well-formed
 *  3. mutation structure
 *  4. ownership (isOwnedBy)
 *  5. CreatePlanStep.planId matches binding
 */
export function validateCommitInput(
  input: AgentCommitInput,
  binding: AgentCommitBinding,
): void {
  if (!isNonEmptyString(input.idempotencyKey)) {
    throw new CommitFailure("ValidationError", "idempotencyKey must be a non-empty string");
  }

  validateReadSet(input.readSet);

  try {
    validateMutationStructure(input.mutation);
  } catch (err) {
    if (err instanceof CommitFailure) throw err;
    throw new CommitFailure("ValidationError", "mutation validation failed");
  }

  if (!isOwnedBy(binding.agentType, input.mutation.kind)) {
    throw new CommitFailure(
      "OwnershipError",
      `${binding.agentType} cannot submit ${input.mutation.kind}`,
    );
  }

  if (input.mutation.kind === "CreatePlanStep" && input.mutation.planId !== binding.planId) {
    throw new CommitFailure(
      "ValidationError",
      "CreatePlanStep planId does not match bound plan",
    );
  }
}
