"use client";

import { opColor } from "@/lib/plan/presentation";
import type { MutationLogEntry } from "@/lib/plan/types";
import type { HoverNode } from "./TypedGraph";

/** Half the popover width (`w-[252px]`), used to clamp it inside the rail. */
const POPOVER_HALF_W = 126;
/** Below this y the popover renders above the node instead of below it. */
const FLIP_ABOVE_Y = 220;
/** Most recent ops to surface in the popover. */
const MAX_OPS = 3;

export interface NodeDetailPopoverProps {
  node: HoverNode;
  /** Lifecycle state label for the node (e.g. "active", "stale"). */
  state: string;
  /** Whether the node is currently lit (has streamed a mutation). */
  isLit: boolean;
  /** Mutations targeting this node, in stream order. */
  ops: MutationLogEntry[];
  /** Rail width (px) used to clamp horizontal position; 0 → no clamp. */
  containerWidth: number;
  onClose: () => void;
}

/**
 * Node-detail popover for the typed-graph rail. Pure presentation: it positions
 * itself near `node.x`/`node.y`, clamped inside the rail and flipped above the
 * node when near the bottom. Shown for both pointer selection and the
 * keyboard-accessible node list in {@link AgentConsole}.
 */
export default function NodeDetailPopover({
  node,
  state,
  isLit,
  ops,
  containerWidth,
  onClose,
}: NodeDetailPopoverProps) {
  const left = containerWidth
    ? Math.min(Math.max(node.x, POPOVER_HALF_W), containerWidth - POPOVER_HALF_W)
    : node.x;
  const above = node.y > FLIP_ABOVE_Y;
  const recentOps = ops.slice(-MAX_OPS);

  return (
    <div
      className="absolute z-20 w-[252px] rounded-xl p-3.5"
      role="dialog"
      aria-label={`${node.label} details`}
      style={{
        left,
        top: node.y,
        transform: above ? "translate(-50%, calc(-100% - 20px))" : "translate(-50%, 20px)",
        background: "rgba(10,16,28,0.94)",
        border: "1px solid rgba(134,168,255,0.32)",
        boxShadow: "0 10px 34px rgba(4,8,20,0.55), inset 0 0 0 1px rgba(125,166,255,0.06)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-display text-sm font-semibold text-white">{node.label}</div>
          <div className="mt-0.5 font-mono text-2xs font-semibold uppercase tracking-wide text-[#a0beff]/80">
            {node.kind}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="-mr-1 -mt-1 flex-none rounded-md px-1.5 py-0.5 text-sm leading-none text-[#a0beff]/60 transition hover:text-white"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      <div className="mt-2.5 flex items-center gap-1.5">
        <span
          className="rounded font-mono text-2xs font-semibold"
          style={{
            color: isLit ? "var(--status-current)" : "#a0beff",
            background: isLit ? "var(--status-current-bg)" : "rgba(134,168,255,0.12)",
            padding: "2px 7px",
          }}
        >
          {state}
        </span>
        {ops.length > 0 && (
          <span className="font-mono text-2xs text-[#a0beff]/60">
            {ops.length} op{ops.length > 1 ? "s" : ""}
          </span>
        )}
      </div>

      {recentOps.length > 0 && (
        <div className="mt-2.5 flex flex-col gap-1">
          {recentOps.map((op) => (
            <div key={op.seq} className="flex items-center gap-1.5">
              <span
                className="rounded px-1.5 py-0.5 font-mono text-2xs font-semibold"
                style={{ color: opColor(op.op), background: `${opColor(op.op)}1f` }}
              >
                {op.op}
              </span>
              <span className="truncate font-mono text-2xs text-[#bed2fa]/70">{op.detail}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
