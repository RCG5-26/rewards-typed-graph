// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import NodeDetailPopover, { type NodeDetailPopoverProps } from "./NodeDetailPopover";
import type { HoverNode } from "./TypedGraph";
import type { MutationLogEntry } from "@/lib/plan/types";

const node = (overrides: Partial<HoverNode> = {}): HoverNode => ({
  id: "n1",
  label: "Chase UR",
  kind: "program",
  x: 100,
  y: 100,
  ...overrides,
});

const op = (seq: number, detail: string): MutationLogEntry =>
  ({ seq, op: "CREATE", detail }) as unknown as MutationLogEntry;

function renderPopover(props: Partial<NodeDetailPopoverProps> = {}) {
  const onClose = vi.fn();
  render(
    <NodeDetailPopover
      node={node()}
      state="active"
      isLit={false}
      ops={[]}
      containerWidth={0}
      onClose={onClose}
      {...props}
    />,
  );
  return { onClose };
}

afterEach(cleanup);

describe("NodeDetailPopover", () => {
  it("clamps to the right bound for nodes past the right rail", () => {
    renderPopover({ node: node({ x: 1000 }), containerWidth: 400 });
    // half-width clamp = 126 → max left = 400 - 126 = 274
    expect(screen.getByRole("dialog")).toHaveStyle({ left: "274px" });
  });

  it("clamps to the left bound for nodes near the left rail", () => {
    renderPopover({ node: node({ x: 10 }), containerWidth: 400 });
    // min left = half-width clamp = 126
    expect(screen.getByRole("dialog")).toHaveStyle({ left: "126px" });
  });

  it("does not clamp when containerWidth is 0", () => {
    renderPopover({ node: node({ x: 50 }), containerWidth: 0 });
    expect(screen.getByRole("dialog")).toHaveStyle({ left: "50px" });
  });

  it("flips above the node when near the bottom", () => {
    renderPopover({ node: node({ y: 300 }) });
    expect(screen.getByRole("dialog").style.transform).toContain("calc(-100% - 20px)");
  });

  it("renders below the node when near the top", () => {
    renderPopover({ node: node({ y: 100 }) });
    expect(screen.getByRole("dialog").style.transform).toBe("translate(-50%, 20px)");
  });

  it("shows the full op count but only the last three op rows", () => {
    const ops = [1, 2, 3, 4, 5].map((n) => op(n, `detail-${n}`));
    renderPopover({ ops });
    expect(screen.getByText(/5 ops/)).toBeInTheDocument();
    expect(screen.queryByText("detail-1")).toBeNull();
    expect(screen.queryByText("detail-2")).toBeNull();
    expect(screen.getByText("detail-3")).toBeInTheDocument();
    expect(screen.getByText("detail-5")).toBeInTheDocument();
  });

  it("moves focus to the close button on open", () => {
    renderPopover();
    expect(screen.getByRole("button", { name: /close/i })).toHaveFocus();
  });

  it("closes on Escape", () => {
    const { onClose } = renderPopover();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
