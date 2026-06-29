/**
 * Demo-only replan trigger: apply the canonical Chase→Hyatt transfer that closes
 * the Ginza award gap, then return the refreshed graph plan for the Test Wallets UI.
 */

import {
  CANONICAL_GRAPH_USER_ID,
  type ApprovedWalletId,
  type CanonicalWalletFacts,
  getCanonicalWallet,
} from "./canonical-wallet";
import { normalizeGraphPlan } from "./adapters/graph-normalizer";
import { evaluatePlan } from "./evaluator";
import type { PlanService } from "../plans/service";
import type { BalanceTransferInput, BalanceTransferResult, PlanView } from "../plans/types";
import type { PlanEngineKind } from "../plans/engine-selector";
import type { ArchitectureComparisonResult } from "./types";

const GRAPH_ENGINE: PlanEngineKind = "orchestrator";

export interface DemoSimulateTransferDeps {
  replanService: PlanService;
  planEngine?: PlanEngineKind;
}

export interface CanonicalTransferSpec {
  sourceProgramId: string;
  destProgramId: string;
  amountPoints: number;
}

export interface DemoSimulateTransferResponse {
  walletId: ApprovedWalletId;
  walletVersion: string;
  idempotencyReplayed: boolean;
  transfer: CanonicalTransferSpec;
  replanJobId: string | null;
  staledPlanId: string | null;
  currentPlan: PlanView;
  graphResult: ArchitectureComparisonResult;
}

/** Derive the hero-demo transfer: Chase→Hyatt for the Ginza award deficit. */
export function deriveCanonicalTransfer(facts: CanonicalWalletFacts): CanonicalTransferSpec {
  const ginza = facts.awardOptions.find((a) => a.pointsRequired === 45000 && a.available);
  if (!ginza) {
    throw new Error("canonical wallet missing the 45,000-point Ginza award");
  }
  const hyattBalance = facts.balances.find((b) => b.programId === ginza.programId);
  if (!hyattBalance) {
    throw new Error("canonical wallet missing Hyatt balance");
  }
  const deficit = ginza.pointsRequired - hyattBalance.points;
  if (deficit <= 0) {
    throw new Error("canonical wallet does not require a transfer for the Ginza award");
  }
  const chaseToHyatt = facts.transferRoutes.find(
    (r) =>
      r.destinationProgramId === ginza.programId &&
      r.ratioBasisPoints === 10_000,
  );
  if (!chaseToHyatt) {
    throw new Error("canonical wallet missing a 1:1 route into Hyatt");
  }
  return {
    sourceProgramId: chaseToHyatt.sourceProgramId,
    destProgramId: chaseToHyatt.destinationProgramId,
    amountPoints: deficit,
  };
}

export async function runDemoSimulateTransfer(
  walletId: ApprovedWalletId,
  deps: DemoSimulateTransferDeps,
  idempotencyKey?: string,
): Promise<DemoSimulateTransferResponse> {
  if (deps.planEngine !== GRAPH_ENGINE) {
    throw new Error(
      `demo simulate transfer requires PLAN_ENGINE=${GRAPH_ENGINE} (server booted "${deps.planEngine ?? "unset"}")`,
    );
  }

  const facts = getCanonicalWallet(walletId);
  if (!facts) {
    throw new Error(`unknown canonical wallet: ${walletId}`);
  }

  const transfer = deriveCanonicalTransfer(facts);
  const input: BalanceTransferInput = {
    ...transfer,
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };

  const result = await deps.replanService.transferBalance(CANONICAL_GRAPH_USER_ID, input);
  const idempotencyReplayed = result.idempotencyReplayed === true;

  // The rev2 plan reflects the post-transfer world (Hyatt now funds the award
  // directly, so it drops the transfer step). Evaluate it against post-transfer
  // balances — using the pre-transfer canonical facts would simulate a direct
  // redemption from the old 30k Hyatt balance and wrongly fail affordability.
  const postTransferFacts = applyTransferToFacts(facts, transfer);

  return {
    walletId,
    walletVersion: facts.version,
    idempotencyReplayed,
    transfer,
    replanJobId: result.replanJobId,
    staledPlanId: result.staledPlanId,
    currentPlan: result.currentPlan,
    graphResult: buildGraphResult(postTransferFacts, result.currentPlan, idempotencyReplayed),
  };
}

/**
 * Apply the canonical transfer to a wallet's balances, returning a new facts
 * object. Mirrors the DB mutation (debit source, credit destination) so the
 * comparison evaluator scores the post-transfer plan against the post-transfer
 * world. Pure — never mutates the input.
 */
export function applyTransferToFacts(
  facts: CanonicalWalletFacts,
  transfer: CanonicalTransferSpec,
): CanonicalWalletFacts {
  const balances = facts.balances.map((balance) => {
    if (balance.programId === transfer.sourceProgramId) {
      return { ...balance, points: balance.points - transfer.amountPoints };
    }
    if (balance.programId === transfer.destProgramId) {
      return { ...balance, points: balance.points + transfer.amountPoints };
    }
    return balance;
  });
  return { ...facts, balances };
}

export function buildGraphResult(
  facts: CanonicalWalletFacts,
  view: PlanView,
  idempotencyReplayed: boolean,
): ArchitectureComparisonResult {
  const plan = normalizeGraphPlan(view, facts);
  return {
    variant: "live-graph-orchestrator",
    status: "succeeded",
    walletId: facts.walletId,
    walletVersion: facts.version,
    query: facts.query,
    plan,
    evaluation: evaluatePlan(plan, facts),
    metrics: { latencyMs: 0 },
    evidence: {
      agentTypes: ["wallet-specialist", "redemption-specialist"],
      planId: view.planId,
      lineageId: view.planLineageId,
      revisionNumber: view.revisionNumber,
      dependencyCount: view.steps.reduce((sum, step) => sum + step.dependencies.length, 0),
      citedAwardIds: view.graph.nodes
        .filter((n) => n.kind === "redemption")
        .map((n) => n.slug),
      availableAwardIds: facts.awardOptions.map((a) => a.awardSlug),
      ...(idempotencyReplayed ? { agentRunCount: 0 } : {}),
    },
  };
}
