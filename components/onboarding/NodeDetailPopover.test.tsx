// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import NodeDetailPopover, { type NodeDetailPopoverProps } from "./NodeDetailPopover";
import type { HoverNode } from "./TypedGraph";

const node = (overrides: Partial<HoverNode> = {}): HoverNode => ({
  id: "n1",
  label: "Chase UR",
  kind: "program",
  x: 100,
  y: 100,
  ...overrides,
});

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
