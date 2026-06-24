import type { GraphSnapshot, GraphSnapshotBuilder } from "../../src/agents/contracts";

export const tokyoSnapshot: GraphSnapshot = {
  userBalances: [
    { id: "balance-chase-ur", programId: "program-chase-ur", balancePoints: 85000, version: 2 },
    { id: "balance-amex-mr", programId: "program-amex-mr", balancePoints: 40000, version: 1 },
  ],
  userGoals: [
    {
      id: "goal-1",
      goalType: "specific_redemption",
      targetRedemptionOptionId: "option-hyatt-tokyo",
    },
  ],
  userProgramStatuses: [],
};

export class StubGraphSnapshotBuilder implements GraphSnapshotBuilder {
  private throwOnBuild: Error | null = null;

  constructor(private readonly snapshot: GraphSnapshot = tokyoSnapshot) {}

  setThrowOnBuild(error: Error): void {
    this.throwOnBuild = error;
  }

  async build(_input: { userId: string; planId: string }): Promise<GraphSnapshot> {
    if (this.throwOnBuild) {
      const error = this.throwOnBuild;
      this.throwOnBuild = null;
      throw error;
    }
    return this.snapshot;
  }
}
