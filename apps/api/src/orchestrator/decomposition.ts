import type { SpecialistAgentType, UserGoalType } from "../agents/contracts";
import type {
  AgentInvocation,
  DecomposedQuery,
  EarningRecommendationOperation,
  RedemptionTraversalOperation,
  WalletAssessmentOperation,
} from "./contracts";
import { OrchestrationError } from "./contracts";

const SPECIALIST_AGENT_TYPES: readonly SpecialistAgentType[] = [
  "wallet_agent",
  "earning_agent",
  "redemption_agent",
];

const USER_GOAL_TYPES: readonly UserGoalType[] = [
  "maximize_points",
  "maximize_cashback",
  "specific_redemption",
  "minimize_fees",
];

const WALLET_OP_KEYS = new Set(["kind", "agentType", "programIds"]);
const EARNING_OP_KEYS = new Set(["kind", "agentType", "spendCategoryIds"]);
const REDEMPTION_OP_KEYS = new Set([
  "kind",
  "agentType",
  "goalType",
  "targetRedemptionOptionId",
  "sourceProgramIds",
]);
const INVOCATION_KEYS = new Set(["agentType", "operation"]);
const DECOMPOSED_QUERY_KEYS = new Set(["invocations"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(obj: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(obj).every((key) => allowed.has(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => isNonEmptyString(item))
  );
}

function invalid(message: string, detail?: Readonly<Record<string, unknown>>): never {
  throw new OrchestrationError("DecompositionInvalid", message, detail);
}

function parseWalletOperation(raw: Record<string, unknown>): WalletAssessmentOperation {
  if (!hasOnlyKeys(raw, WALLET_OP_KEYS)) invalid("wallet operation has unexpected keys");
  if (raw.kind !== "assess_wallet") invalid("wallet operation kind mismatch");
  if (raw.agentType !== "wallet_agent") invalid("wallet operation agentType mismatch");
  if (!isNonEmptyStringArray(raw.programIds)) invalid("wallet operation requires programIds");
  return {
    kind: "assess_wallet",
    agentType: "wallet_agent",
    programIds: raw.programIds,
  };
}

function parseEarningOperation(raw: Record<string, unknown>): EarningRecommendationOperation {
  if (!hasOnlyKeys(raw, EARNING_OP_KEYS)) invalid("earning operation has unexpected keys");
  if (raw.kind !== "recommend_earning") invalid("earning operation kind mismatch");
  if (raw.agentType !== "earning_agent") invalid("earning operation agentType mismatch");
  if (!isNonEmptyStringArray(raw.spendCategoryIds)) {
    invalid("earning operation requires spendCategoryIds");
  }
  return {
    kind: "recommend_earning",
    agentType: "earning_agent",
    spendCategoryIds: raw.spendCategoryIds,
  };
}

function parseRedemptionOperation(raw: Record<string, unknown>): RedemptionTraversalOperation {
  if (!hasOnlyKeys(raw, REDEMPTION_OP_KEYS)) invalid("redemption operation has unexpected keys");
  if (raw.kind !== "traverse_redemption") invalid("redemption operation kind mismatch");
  if (raw.agentType !== "redemption_agent") invalid("redemption operation agentType mismatch");
  if (!isNonEmptyString(raw.goalType) || !USER_GOAL_TYPES.includes(raw.goalType as UserGoalType)) {
    invalid("redemption operation requires valid goalType");
  }
  if (
    raw.targetRedemptionOptionId !== null &&
    !isNonEmptyString(raw.targetRedemptionOptionId)
  ) {
    invalid("redemption operation has invalid targetRedemptionOptionId");
  }
  if (!isNonEmptyStringArray(raw.sourceProgramIds)) {
    invalid("redemption operation requires sourceProgramIds");
  }
  return {
    kind: "traverse_redemption",
    agentType: "redemption_agent",
    goalType: raw.goalType as UserGoalType,
    targetRedemptionOptionId: raw.targetRedemptionOptionId as string | null,
    sourceProgramIds: raw.sourceProgramIds,
  };
}

function parseOperation(
  agentType: SpecialistAgentType,
  raw: Record<string, unknown>,
):
  | WalletAssessmentOperation
  | EarningRecommendationOperation
  | RedemptionTraversalOperation {
  const kind = raw.kind;
  if (typeof kind !== "string") invalid("operation kind must be a string");

  switch (agentType) {
    case "wallet_agent":
      if (kind !== "assess_wallet") invalid("wallet_agent requires assess_wallet operation");
      return parseWalletOperation(raw);
    case "earning_agent":
      if (kind !== "recommend_earning") invalid("earning_agent requires recommend_earning operation");
      return parseEarningOperation(raw);
    case "redemption_agent":
      if (kind !== "traverse_redemption") {
        invalid("redemption_agent requires traverse_redemption operation");
      }
      return parseRedemptionOperation(raw);
    default: {
      const _exhaustive: never = agentType;
      return invalid(`unknown agent type: ${_exhaustive}`);
    }
  }
}

function parseInvocation(raw: unknown): AgentInvocation {
  if (!isRecord(raw)) invalid("invocation must be an object");
  if (!hasOnlyKeys(raw, INVOCATION_KEYS)) invalid("invocation has unexpected keys");
  const agentType = raw.agentType;
  if (!isNonEmptyString(agentType) || !SPECIALIST_AGENT_TYPES.includes(agentType as SpecialistAgentType)) {
    invalid("unknown agentType");
  }
  if (!isRecord(raw.operation)) invalid("operation must be an object");
  const operation = parseOperation(agentType as SpecialistAgentType, raw.operation);
  if (operation.agentType !== agentType) {
    invalid("invocation agentType does not match operation.agentType");
  }
  return { agentType: agentType as SpecialistAgentType, operation } as AgentInvocation;
}

export function validateDecomposedQuery(raw: unknown): DecomposedQuery {
  if (!isRecord(raw)) invalid("decomposed query must be an object");
  if (!hasOnlyKeys(raw, DECOMPOSED_QUERY_KEYS)) invalid("decomposed query has unexpected keys");
  if (!Array.isArray(raw.invocations) || raw.invocations.length === 0) {
    invalid("invocations must be a non-empty array");
  }
  const invocations = raw.invocations.map((item) => parseInvocation(item));
  return { invocations };
}
