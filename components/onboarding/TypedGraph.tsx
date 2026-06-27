"use client";

import { useEffect, useRef } from "react";

import type { PlanGraph } from "@/lib/plan/types";
import { buildBranches, buildTraversalChain } from "@/lib/plan/graph-traversal";
import { useReducedMotion } from "@/lib/use-reduced-motion";

/**
 * Typed-graph traversal as a glowing network: one luminous dot per node that
 * actually exists in the streamed graph, joined by the real graph edges, with
 * stale nodes/edges in red and a refined plane that flies the active path and
 * loops. Node positions come from the real traversal chain + branches
 * (`lib/plan/graph-traversal`); nothing here is decorative — every dot is a
 * node, every link is an edge.
 */

const ACCENT = { r: 134, g: 168, b: 255 };
const STALE = { r: 236, g: 98, b: 92 };

export interface HoverNode {
  id: string;
  label: string;
  kind: string;
  x: number;
  y: number;
}

/** A hub's screen position + hit radius, used for pointer hit-testing. */
export interface HubHit extends HoverNode {
  r: number;
}

/**
 * The hub nearest to `(mx, my)` within its hit radius, or `null`. The radius is
 * padded (≥20px, or 2.6× the bead) so small beads stay comfortably clickable.
 */
export function nearestHub(hubs: HubHit[], mx: number, my: number): HubHit | null {
  let best: HubHit | null = null;
  let bestD = Infinity;
  for (const hp of hubs) {
    const d = Math.hypot(mx - hp.x, my - hp.y);
    const hit = Math.max(20, hp.r * 2.6);
    if (d < hit && d < bestD) {
      bestD = d;
      best = hp;
    }
  }
  return best;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface NodePos {
  x: number;
  depth: number;
  label: string;
  kind: string;
  stale: boolean;
  hub: boolean;
}

/** Lay out every real node in disc coords (x ∈ [-1,1], depth ∈ [0,1]). */
function layout(graph: PlanGraph): Map<string, NodePos> {
  const pos = new Map<string, NodePos>();
  const main = buildTraversalChain(graph);
  const branches = buildBranches(graph, main);
  for (const h of main) {
    pos.set(h.id, {
      x: h.x,
      depth: h.depth,
      label: h.label,
      kind: h.kind,
      stale: h.stale,
      hub: true,
    });
  }
  for (const b of branches) {
    if (!pos.has(b.id)) {
      pos.set(b.id, {
        x: b.x,
        depth: b.depth,
        label: b.label,
        kind: b.kind,
        stale: b.stale,
        hub: false,
      });
    }
  }
  // leftover nodes (e.g. a stale node reachable only via a stale edge): anchor
  // each to a connected, already-placed node so it lands somewhere sensible.
  let li = 0;
  for (const n of graph.nodes) {
    if (pos.has(n.id)) continue;
    const e = graph.edges.find(
      (ed) => (ed.from === n.id && pos.has(ed.to)) || (ed.to === n.id && pos.has(ed.from)),
    );
    const anchorId = e ? (e.from === n.id ? e.to : e.from) : main[0]?.id;
    const a = anchorId ? pos.get(anchorId) : undefined;
    const ax = a?.x ?? 0;
    const ad = a?.depth ?? 0.4;
    pos.set(n.id, {
      x: clamp(ax + (ax >= 0 ? 0.42 : -0.42) + li * 0.06, -0.84, 0.84),
      depth: clamp(ad + 0.04 + li * 0.12, 0.02, 0.96),
      label: n.label,
      kind: n.kind,
      stale: n.state === "stale",
      hub: false,
    });
    li++;
  }
  return pos;
}

export default function TypedGraph({
  graph,
  litNodeIds,
  onHover,
  onSelect,
}: {
  graph: PlanGraph;
  litNodeIds: Set<string>;
  onHover?: (node: HoverNode | null) => void;
  onSelect?: (node: HoverNode | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reduced = useReducedMotion();
  const stateRef = useRef({ graph, litNodeIds, reduced, onHover, onSelect });
  stateRef.current = { graph, litNodeIds, reduced, onHover, onSelect };
  const hubPosRef = useRef<HubHit[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0,
      h = 0,
      dpr = 1,
      cx = 0,
      cy = 0;
    let prog = 0;
    let raf = 0;

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const nw = Math.max(1, Math.round(r.width));
      const nh = Math.max(1, Math.round(r.height));
      const nd = Math.min(2, window.devicePixelRatio || 1);
      cx = nw / 2;
      cy = nh / 2;
      if (nw === w && nh === h && nd === dpr) return;
      w = nw;
      h = nh;
      dpr = nd;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    // disc coord → screen (recenters depth so the field fills the panel)
    const project = (sx: number, depth: number) => ({
      x: cx + sx * (w * 0.42),
      y: cy + (depth - 0.4) * (h * 0.62),
    });

    const drawPlane = (x: number, y: number, ang: number, acc: (a: number) => string) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.globalCompositeOperation = "lighter";
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 20);
      g.addColorStop(0, acc(0.55));
      g.addColorStop(1, acc(0));
      ctx.fillStyle = g;
      ctx.fillRect(-20, -20, 40, 40);
      ctx.globalCompositeOperation = "source-over";
      ctx.scale(1.25, 1.25);
      ctx.beginPath();
      ctx.moveTo(11, 0);
      ctx.lineTo(1, 1.7);
      ctx.lineTo(-4, 7);
      ctx.lineTo(-6, 6.6);
      ctx.lineTo(-3.2, 1.5);
      ctx.lineTo(-7.5, 2.8);
      ctx.lineTo(-8.6, 2.4);
      ctx.lineTo(-7, 0);
      ctx.lineTo(-8.6, -2.4);
      ctx.lineTo(-7.5, -2.8);
      ctx.lineTo(-3.2, -1.5);
      ctx.lineTo(-6, -6.6);
      ctx.lineTo(-4, -7);
      ctx.lineTo(1, -1.7);
      ctx.closePath();
      ctx.fillStyle = "#eef3ff";
      ctx.fill();
      ctx.strokeStyle = acc(0.9);
      ctx.lineWidth = 0.6;
      ctx.stroke();
      ctx.fillStyle = acc(0.95);
      ctx.beginPath();
      ctx.arc(3.5, 0, 1.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    const loop = (now: number) => {
      resize();
      if (w < 2 || h < 2) {
        raf = requestAnimationFrame(loop);
        return;
      }
      const { graph: g, litNodeIds: lit, reduced: rm } = stateRef.current;
      const time = rm ? 0 : now / 1000;
      const acc = (a: number) => `rgba(${ACCENT.r},${ACCENT.g},${ACCENT.b},${a})`;
      const stl = (a: number) => `rgba(${STALE.r},${STALE.g},${STALE.b},${a})`;

      const pos = layout(g);
      const main = buildTraversalChain(g);
      const scr = new Map<string, { x: number; y: number }>();
      for (const [id, d] of pos) scr.set(id, project(d.x, d.depth));

      // ── flat deep-space background + soft iris core glow ──
      ctx.globalCompositeOperation = "source-over";
      const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.78);
      bg.addColorStop(0, "#0a1020");
      bg.addColorStop(0.7, "#070b16");
      bg.addColorStop(1, "#04060d");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      const hg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.5);
      hg.addColorStop(0, "rgba(86,126,206,0.18)");
      hg.addColorStop(0.5, "rgba(50,80,150,0.06)");
      hg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = hg;
      ctx.fillRect(0, 0, w, h);

      const litV = (id: string): number => {
        const d = pos.get(id);
        if (d?.stale) return 1;
        return lit.has(id) ? 1 : 0.35;
      };

      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      // ── real edges as glowing links (dashed red when stale) ──
      for (const e of g.edges) {
        const pa = scr.get(e.from);
        const pb = scr.get(e.to);
        if (!pa || !pb) continue;
        const isStale =
          e.state === "stale" ||
          e.state === "superseded" ||
          pos.get(e.from)?.stale ||
          pos.get(e.to)?.stale;
        if (isStale) {
          ctx.setLineDash([5, 6]);
          ctx.beginPath();
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pb.x, pb.y);
          ctx.strokeStyle = stl(0.42);
          ctx.lineWidth = 1.2;
          ctx.stroke();
          ctx.setLineDash([]);
        } else {
          const live = Math.max(litV(e.from), litV(e.to));
          ctx.globalCompositeOperation = "lighter";
          ctx.beginPath();
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pb.x, pb.y);
          ctx.strokeStyle = acc(0.05 + live * 0.05);
          ctx.lineWidth = 6;
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pb.x, pb.y);
          ctx.strokeStyle = acc(0.16 + live * 0.34);
          ctx.lineWidth = 1.3;
          ctx.stroke();
          ctx.globalCompositeOperation = "source-over";
        }
      }

      // ── flight path: bright traveled contrail along the active chain ──
      const pathPts = main.map((h) => scr.get(h.id)).filter(Boolean) as { x: number; y: number }[];
      const S = Math.max(1, pathPts.length - 1);
      const segAt = (p: number) => {
        const seg = Math.min(Math.floor(p), pathPts.length - 2);
        const f = p - seg;
        const a = pathPts[seg],
          b = pathPts[seg + 1];
        return { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f), seg };
      };

      if (pathPts.length >= 2) {
        // The plane continuously flies the route and loops, so it's always
        // visibly in motion. Reduced motion parks it at the end of the path.
        if (rm) {
          prog = S;
        } else {
          prog += 0.012;
          if (prog >= S) prog = 0;
        }

        const head = segAt(prog);
        ctx.globalCompositeOperation = "lighter";
        const drawTrail = (lw: number, a: number) => {
          ctx.beginPath();
          ctx.moveTo(pathPts[0].x, pathPts[0].y);
          for (let s = 1; s <= head.seg; s++) ctx.lineTo(pathPts[s].x, pathPts[s].y);
          ctx.lineTo(head.x, head.y);
          ctx.strokeStyle = acc(a);
          ctx.lineWidth = lw;
          ctx.stroke();
        };
        drawTrail(10, 0.08);
        drawTrail(4.5, 0.22);
        drawTrail(2, 0.9);
        ctx.globalCompositeOperation = "source-over";
      }

      // ── nodes (dots) ──
      const hubPos: HubHit[] = [];
      for (const [id, d] of pos) {
        const p = scr.get(id)!;
        const isStale = d.stale;
        const HA = isStale ? STALE : ACCENT;
        const hacc = (a: number) => `rgba(${HA.r},${HA.g},${HA.b},${a})`;
        const lv = litV(id);
        const pulse = rm ? 1 : 0.5 + 0.5 * Math.sin(time * 2.2 + p.x * 0.01);
        const baseR = d.hub ? 11 : 7;
        hubPos.push({ id, label: d.label, kind: d.kind, x: p.x, y: p.y, r: baseR });

        ctx.globalCompositeOperation = "lighter";
        const glowR = baseR * (3 + lv * 2.2);
        const ga = (0.08 + lv * 0.5) * (0.72 + 0.28 * pulse);
        const gg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR);
        gg.addColorStop(0, hacc(ga));
        gg.addColorStop(0.45, hacc(ga * 0.28));
        gg.addColorStop(1, hacc(0));
        ctx.fillStyle = gg;
        ctx.fillRect(p.x - glowR, p.y - glowR, glowR * 2, glowR * 2);

        ctx.globalCompositeOperation = "source-over";
        const coreR = baseR * 0.6;
        const cg = ctx.createRadialGradient(
          p.x - coreR * 0.25,
          p.y - coreR * 0.25,
          0,
          p.x,
          p.y,
          coreR,
        );
        cg.addColorStop(0, `rgba(255,255,255,${0.55 + 0.45 * lv})`);
        cg.addColorStop(0.4, hacc(0.95));
        cg.addColorStop(1, hacc(0.55 + 0.3 * lv));
        ctx.fillStyle = cg;
        ctx.beginPath();
        ctx.arc(p.x, p.y, coreR, 0, Math.PI * 2);
        ctx.fill();

        if (isStale) {
          ctx.strokeStyle = hacc(0.6 + 0.3 * pulse);
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.arc(p.x, p.y, baseR * 1.55, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // inline label to the right
        const label = isStale ? "stale" : d.label;
        const fs = d.hub ? 14 : 12;
        ctx.font = `${d.hub ? 600 : 500} ${fs}px var(--font-display), ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillStyle = isStale ? stl(0.95) : `rgba(255,255,255,${0.6 + 0.4 * lv})`;
        ctx.fillText(
          label.length > 24 ? label.slice(0, 23) + "…" : label,
          p.x + baseR * 1.5 + 6,
          p.y,
        );
        ctx.textAlign = "start";
        ctx.textBaseline = "alphabetic";
      }

      // ── the plane at the head of the contrail ──
      if (pathPts.length >= 2) {
        const head = segAt(prog);
        const ahead = segAt(Math.min(S, prog + 0.03));
        const ang = Math.atan2(ahead.y - head.y, ahead.x - head.x);
        drawPlane(head.x, head.y, ang, acc);
      }

      // ── vignette ──
      ctx.globalCompositeOperation = "source-over";
      const vg = ctx.createLinearGradient(0, 0, 0, h);
      vg.addColorStop(0, "rgba(4,6,13,0.45)");
      vg.addColorStop(0.18, "rgba(4,6,13,0)");
      vg.addColorStop(0.82, "rgba(4,6,13,0)");
      vg.addColorStop(1, "rgba(4,6,13,0.5)");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);

      hubPosRef.current = hubPos;
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);

    const hitTest = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      return nearestHub(hubPosRef.current, clientX - rect.left, clientY - rect.top);
    };
    const toNode = (hp: HubHit | null): HoverNode | null =>
      hp ? { id: hp.id, label: hp.label, kind: hp.kind, x: hp.x, y: hp.y } : null;

    const onMove = (e: PointerEvent) => {
      const best = hitTest(e.clientX, e.clientY);
      canvas.style.cursor = best ? "pointer" : "default";
      stateRef.current.onHover?.(toNode(best));
    };
    const onLeave = () => stateRef.current.onHover?.(null);
    const onClick = (e: MouseEvent) => {
      stateRef.current.onSelect?.(toNode(hitTest(e.clientX, e.clientY)));
    };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("click", onClick);

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("click", onClick);
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />;
}
