// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import type { ActivityEntry, AgentActivityTrace } from "@/lib/plan/activity";
import AgentActivity from "./AgentActivity";

afterEach(cleanup);

const trace = (entries: ActivityEntry[]): AgentActivityTrace => ({ planLineageId: "lin-1", entries });

describe("AgentActivity", () => {
  it("renders entries as an ordered list, preserving order", () => {
    render(
      <AgentActivity
        trace={trace([
          { kind: "specialist_run", runId: "r1", specialist: "wallet_agent", operation: "assess_wallet", status: "succeeded" },
          { kind: "specialist_run", runId: "r2", specialist: "redemption_agent", operation: "traverse_redemption", status: "succeeded" },
          { kind: "plan_lifecycle", revision: 1, transition: "committed", status: "succeeded" },
        ])}
      />,
    );
    const list = screen.getByRole("list");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    // ol element conveys order semantically
    expect(list.tagName).toBe("OL");
  });

  it("labels distinct specialists", () => {
    render(
      <AgentActivity
        trace={trace([
          { kind: "specialist_run", runId: "r1", specialist: "wallet_agent", operation: "assess_wallet", status: "succeeded" },
          { kind: "specialist_run", runId: "r2", specialist: "redemption_agent", operation: "traverse_redemption", status: "succeeded" },
        ])}
      />,
    );
    expect(screen.getByText(/Wallet · assess_wallet/)).toBeInTheDocument();
    expect(screen.getByText(/Redemption · traverse_redemption/)).toBeInTheDocument();
  });

  it("shows revision lifecycle transitions: committed → stale → promoted", () => {
    render(
      <AgentActivity
        trace={trace([
          { kind: "plan_lifecycle", revision: 1, transition: "committed", status: "succeeded" },
          { kind: "plan_lifecycle", revision: 1, transition: "stale", status: "succeeded", reason: "Chase UR balance changed" },
          { kind: "plan_lifecycle", revision: 2, transition: "promoted", status: "succeeded" },
        ])}
      />,
    );
    expect(screen.getByText("Plan revision 1 committed")).toBeInTheDocument();
    expect(screen.getByText("Plan revision 1 marked stale")).toBeInTheDocument();
    expect(screen.getByText("Chase UR balance changed")).toBeInTheDocument();
    expect(screen.getByText("Plan revision 2 promoted")).toBeInTheDocument();
  });

  it("conveys status without color via screen-reader text (not just a glyph)", () => {
    render(
      <AgentActivity
        trace={trace([
          { kind: "specialist_run", runId: "r1", specialist: "wallet_agent", operation: "assess_wallet", status: "failed" },
          { kind: "plan_lifecycle", revision: 1, transition: "stale", status: "succeeded" },
        ])}
      />,
    );
    expect(screen.getByText("failed:")).toBeInTheDocument();
    expect(screen.getByText("needs attention:")).toBeInTheDocument();
  });

  it("renders specialist sub-lines (snapshot, commit, detail) when present", () => {
    render(
      <AgentActivity
        trace={trace([
          {
            kind: "specialist_run",
            runId: "r1",
            specialist: "wallet_agent",
            operation: "assess_wallet",
            status: "succeeded",
            snapshotVersion: "wallet-state-v1",
            commit: { result: "committed", mutationTxnId: "txn-1" },
            detail: "Dependency recorded: Chase UR balance",
          },
        ])}
      />,
    );
    expect(screen.getByText("Snapshot: wallet-state-v1")).toBeInTheDocument();
    expect(screen.getByText("Commit recorded")).toBeInTheDocument();
    expect(screen.getByText("Dependency recorded: Chase UR balance")).toBeInTheDocument();
  });

  it("surfaces a commit failure class", () => {
    render(
      <AgentActivity
        trace={trace([
          {
            kind: "specialist_run",
            runId: "r1",
            specialist: "wallet_agent",
            operation: "assess_wallet",
            status: "failed",
            commit: { result: "failed", failureClass: "OwnershipError" },
          },
        ])}
      />,
    );
    expect(screen.getByText("Commit failed: OwnershipError")).toBeInTheDocument();
  });

  it("renders the empty state", () => {
    render(<AgentActivity trace={trace([])} />);
    expect(screen.getByText("No agent activity yet.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("renders the loading state with a status role", () => {
    render(<AgentActivity phase="loading" />);
    expect(screen.getByRole("status")).toHaveTextContent(/Loading/);
  });

  it("renders the error state with an alert role", () => {
    render(<AgentActivity phase="error" error="Stream unavailable" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Stream unavailable");
  });

  it("exposes a labelled region for the panel", () => {
    render(<AgentActivity trace={trace([])} title="Agent activity" />);
    expect(screen.getByRole("region", { name: "Agent activity" })).toBeInTheDocument();
  });
});
