import {
  type BalanceTransferInput,
  type BalanceTransferResult,
  type PlanView,
  type SessionIdentity,
  type SessionView,
} from "./types";

/**
 * Domain error the routes translate into HTTP status codes. Keeping the port
 * HTTP-agnostic means the in-memory fake (tests) and the Python bridge
 * (production) raise the same vocabulary, and only `routes.ts` knows about 4xx.
 */
export type PlanServiceErrorCode = "validation" | "not_found" | "conflict";

export class PlanServiceError extends Error {
  /** Carry a route-mappable error code alongside the human-readable message. */
  constructor(
    readonly code: PlanServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PlanServiceError";
  }
}

/**
 * The seam between the HTTP layer and the plan engine. Production wires
 * `BridgePlanService` (spawns the verified Python hero seam); tests wire an
 * in-memory fake. Implementations own the DB→view projection so there is one
 * source of truth for plan shapes.
 */
export interface PlanService {
  getSession(identity: SessionIdentity): Promise<SessionView>;
  resetDemo(userId: string): Promise<SessionView>;
  createPlan(userId: string, query: string, cardSlugs?: string[]): Promise<PlanView>;
  getPlanById(userId: string, planId: string): Promise<PlanView | null>;
  getCurrentPlan(userId: string, lineageId: string): Promise<PlanView | null>;
  transferBalance(
    userId: string,
    input: BalanceTransferInput,
  ): Promise<BalanceTransferResult>;
}
