"use client";

import { useEffect, useRef } from "react";

import type { PlanGraph } from "@/lib/plan/types";
import { buildTraversalChain } from "@/lib/plan/graph-traversal";
import { useReducedMotion } from "@/lib/use-reduced-motion";

/**
 * Typed-graph traversal as a night city seen from a plane window. Ported from
 * the design mock's `night-graph` canvas (perspective block-grid city lights, a
 * horizon glow, a glowing 3D flight path) and driven by the *real* streamed
 * graph: the flight path is the actual traversal chain (from `graph.edges`), and
 * nodes light as their mutations arrive (`litNodeIds`). A refined plane flies the
 * path to the lit frontier, then loops. Nothing about the route is hardcoded.
 */

const ACCENT = { r: 134, g: 168, b: 255 };
const STALE = { r: 236, g: 98, b: 92 };

interface Light {
  x: number;
  depth: number;
  warm: boolean;
  base: number;
  size: number;
  speed: number;
  phase: number;
  twinkle: boolean;
  land: boolean;
}

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
 * Returns `null` for an empty set, so a cleared route never resolves to a stale
 * target.
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

const ease = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * A fuzzy circular constellation: stars scattered inside a unit disc, denser
 * toward the center and thinning to a soft rim. `x`/`depth` hold normalized disc
 * coordinates in [-1, 1] (no perspective grid — the field is a circle, not a
 * dome). The draw loop maps them to screen against a circular mask.
 */
function genLights(): Light[] {
  const out: Light[] = [];
  const N = 540;
  for (let i = 0; i < N; i++) {
    const ang = Math.random() * Math.PI * 2;
    // bias radius toward the center so density tapers outward (fuzzy edge)
    const r = Math.pow(Math.random(), 0.62);
    out.push({
      x: Math.cos(ang) * r,
      depth: Math.sin(ang) * r,
      warm: Math.random() < 0.25,
      base: 0.2 + Math.random() * 0.6,
      size: 0.45 + Math.random() * 1.35,
      speed: 0.5 + Math.random() * 2.4,
      phase: Math.random() * Math.PI * 2,
      twinkle: Math.random() < 0.55,
      land: false,
    });
  }
  return out;
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

    const lights = genLights();
    let w = 0, h = 0, dpr = 1, cx = 0, horizonY = 0, scale = 1;
    let prog = 0;
    let raf = 0;
    const t0 = performance.now();

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const nw = Math.max(1, Math.round(r.width));
      const nh = Math.max(1, Math.round(r.height));
      const nd = Math.min(2, window.devicePixelRatio || 1);
      cx = nw / 2;
      scale = Math.min(nw, nh);
      horizonY = nh * 0.24;
      if (nw === w && nh === h && nd === dpr) return;
      w = nw; h = nh; dpr = nd;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const project = (x: number, depth: number, height: number) => {
      const nearY = h * 1.04;
      const persp = 1 / (1 + depth * 2.3);
      return {
        x: cx + x * (w * 0.62) * persp,
        y: horizonY + (nearY - horizonY) * persp - height * persp * scale,
        s: persp,
      };
    };

    const drawPlane = (x: number, y: number, ang: number, acc: (a: number) => string) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      // glow
      ctx.globalCompositeOperation = "lighter";
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 16);
      g.addColorStop(0, acc(0.5));
      g.addColorStop(1, acc(0));
      ctx.fillStyle = g;
      ctx.fillRect(-16, -16, 32, 32);
      // refined top-down jet silhouette (nose +x)
      ctx.globalCompositeOperation = "source-over";
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
      // cockpit pip
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
      const hubs = buildTraversalChain(g);
      const S = Math.max(1, hubs.length - 1);
      // Collected each frame; assigned to the ref AFTER the route block so a
      // cleared/short route resets hit-testing to an empty set (no stale hubs).
      const hubPos: HubHit[] = [];

      // ── background sky → ground ──
      ctx.globalCompositeOperation = "source-over";
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, "#070b16");
      bg.addColorStop((horizonY / h) * 0.85, "#0a1020");
      bg.addColorStop(horizonY / h, "#0e1730");
      bg.addColorStop(0.62, "#0a1020");
      bg.addColorStop(1, "#04060d");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      const hg = ctx.createRadialGradient(cx, horizonY, 0, cx, horizonY, Math.max(w, h) * 0.7);
      hg.addColorStop(0, "rgba(86,126,206,0.30)");
      hg.addColorStop(0.4, "rgba(50,80,150,0.11)");
      hg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = hg;
      ctx.fillRect(0, 0, w, h * 0.8);

      // ── fuzzy circular constellation ──
      // Map each star's unit-disc coordinate to a circle on screen (no
      // perspective dome). Density already tapers outward; the rim fade makes
      // the edge fuzzy. Tune the center/radius here to reposition the circle.
      const fieldCx = cx;
      const fieldCy = horizonY + (h - horizonY) * 0.34;
      const fieldR = Math.min(w, h) * 0.46;
      ctx.globalCompositeOperation = "lighter";
      for (const L of lights) {
        const ru = Math.hypot(L.x, L.depth); // 0 (center) → ~1 (rim)
        const px = fieldCx + L.x * fieldR;
        const py = fieldCy + L.depth * fieldR;
        // soft circular rim: full inside, easing to 0 past ~0.7 of the radius
        const mask = 1 - ease((ru - 0.7) / 0.3);
        if (mask <= 0.001) continue;
        // brighter toward the center; depth-like scale from the radius
        const s = 0.55 + 0.45 * (1 - ru);
        let a = L.base * (0.45 + 0.55 * s) * mask;
        if (L.twinkle && !rm) a *= 0.6 + 0.4 * Math.sin(time * L.speed + L.phase);
        if (a <= 0.012) continue;
        const rad = L.size * s + 0.35;
        const col = L.warm ? "255,206,150" : "176,204,255";
        // Each light is ONE soft radial gradient with a bright, fuzzy center
        // that fades smoothly to nothing — no hard-edged core disc (a crisp
        // arc at ~1px reads as a square pixel). Floored radius gives even the
        // far stars room to resolve as a fuzzy circle. The fill is clipped to a
        // circle (arc), so the bounding box is never visible.
        const bloom = Math.max(3.5, rad * 4.5);
        const gg = ctx.createRadialGradient(px, py, 0, px, py, bloom);
        gg.addColorStop(0, `rgba(${col},${Math.min(1, a * 1.9)})`);
        gg.addColorStop(0.1, `rgba(${col},${Math.min(1, a * 1.1)})`);
        gg.addColorStop(0.28, `rgba(${col},${a * 0.4})`);
        gg.addColorStop(0.55, `rgba(${col},${a * 0.1})`);
        gg.addColorStop(0.8, `rgba(${col},${a * 0.03})`);
        gg.addColorStop(1, `rgba(${col},0)`);
        ctx.fillStyle = gg;
        ctx.beginPath();
        ctx.arc(px, py, bloom, 0, Math.PI * 2);
        ctx.fill();
      }

      // ── flight path ──
      const samplePt = (seg: number, s: number) => {
        const a = hubs[seg], b = hubs[seg + 1];
        const arc = 0.1 + 0.05 * (1 - Math.min(a.depth, b.depth));
        return project(lerp(a.x, b.x, s), lerp(a.depth, b.depth, s), Math.sin(Math.PI * s) * arc);
      };

      if (hubs.length >= 2) {
        // advance the plane toward the lit frontier; loop when fully lit
        const litCount = hubs.filter((hb) => lit.has(hb.id)).length;
        const frontier = Math.max(0, litCount - 1);
        if (rm) {
          prog = frontier;
        } else if (litCount >= hubs.length) {
          prog += 0.009;
          if (prog >= S) prog = 0;
        } else {
          prog = prog < frontier ? Math.min(frontier, prog + 0.012) : frontier;
        }

        // faint full route
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        for (let seg = 0; seg < S; seg++) {
          for (let i = 0; i <= 20; i++) {
            const p = samplePt(seg, i / 20);
            if (seg === 0 && i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
          }
        }
        ctx.strokeStyle = acc(0.13);
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // traveled trail (contrail) up to the plane
        const pts: { x: number; y: number }[] = [];
        const segDone = Math.min(Math.floor(prog), S - 1);
        for (let seg = 0; seg <= segDone; seg++) {
          const top = seg < segDone ? 1 : Math.min(1, prog - seg);
          const steps = 24, maxI = Math.round(top * steps);
          for (let i = 0; i <= maxI; i++) pts.push(samplePt(seg, i / steps));
        }
        if (pts.length > 1) {
          const stroke = (lw: number, a: number) => {
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
            ctx.strokeStyle = acc(a);
            ctx.lineWidth = lw;
            ctx.stroke();
          };
          stroke(10, 0.08);
          stroke(5, 0.18);
          stroke(2.2, 0.85);
        }

        // ── hubs as luminous beads ──
        for (let i = 0; i < hubs.length; i++) {
          const hub = hubs[i];
          const isStale = hub.stale;
          const HA = isStale ? STALE : ACCENT;
          const hacc = (a: number) => `rgba(${HA.r},${HA.g},${HA.b},${a})`;
          const litV = lit.has(hub.id) || isStale ? 1 : prog >= i - 0.04 ? 0.5 : 0.12;
          const p = project(hub.x, hub.depth, 0);
          const pulse = rm ? 1 : 0.5 + 0.5 * Math.sin(time * 2.4 + i);
          const baseR = lerp(6, 11, p.s);
          const kind = i === hubs.length - 1 ? "redemption" : "program";
          hubPos.push({ id: hub.id, label: hub.label, kind, x: p.x, y: p.y, r: baseR });

          ctx.globalCompositeOperation = "lighter";
          const glowR = baseR * (3 + litV * 2.2);
          const ga = (0.1 + litV * 0.55) * (0.72 + 0.28 * pulse);
          const gg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR);
          gg.addColorStop(0, hacc(ga));
          gg.addColorStop(0.45, hacc(ga * 0.28));
          gg.addColorStop(1, hacc(0));
          ctx.fillStyle = gg;
          ctx.fillRect(p.x - glowR, p.y - glowR, glowR * 2, glowR * 2);

          ctx.globalCompositeOperation = "source-over";
          const coreR = baseR * 0.58;
          const cg = ctx.createRadialGradient(p.x - coreR * 0.25, p.y - coreR * 0.25, 0, p.x, p.y, coreR);
          cg.addColorStop(0, `rgba(255,255,255,${0.55 + 0.45 * litV})`);
          cg.addColorStop(0.4, hacc(0.95));
          cg.addColorStop(1, hacc(0.55 + 0.3 * litV));
          ctx.fillStyle = cg;
          ctx.beginPath();
          ctx.arc(p.x, p.y, coreR, 0, Math.PI * 2);
          ctx.fill();

          if (isStale) {
            ctx.strokeStyle = hacc(0.6 + 0.3 * pulse);
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.arc(p.x, p.y, baseR * 1.6, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
          }

          // label when lit / stale
          const la = isStale ? 1 : ease((litV - 0.15) / 0.6);
          if (la > 0.04) {
            const fs = 12;
            ctx.font = `600 ${fs}px var(--font-mono), ui-monospace, monospace`;
            const label = hub.label.length > 22 ? hub.label.slice(0, 21) + "…" : hub.label;
            const sub = isStale ? "STALE" : i === hubs.length - 1 ? "REDEMPTION" : "PROGRAM";
            const tw = ctx.measureText(label).width;
            const padX = 9, bw = tw + padX * 2, bh = fs + 19;
            let bx = p.x - bw / 2;
            bx = Math.max(6, Math.min(w - bw - 6, bx));
            const by = p.y - baseR - 14 - bh;
            roundRect(ctx, bx, by, bw, bh, 7);
            ctx.fillStyle = `rgba(12,18,32,${0.9 * la})`;
            ctx.fill();
            ctx.strokeStyle = hacc(0.4 * la);
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillStyle = `rgba(255,255,255,${la})`;
            ctx.fillText(label, bx + bw / 2, by + 5);
            ctx.fillStyle = hacc(0.9 * la);
            ctx.font = `600 8px var(--font-mono), ui-monospace, monospace`;
            ctx.fillText(sub, bx + bw / 2, by + 5 + fs + 2);
            ctx.strokeStyle = hacc(0.35 * la);
            ctx.beginPath();
            ctx.moveTo(p.x, by + bh);
            ctx.lineTo(p.x, p.y - baseR - 2);
            ctx.stroke();
            ctx.textAlign = "start";
            ctx.textBaseline = "alphabetic";
          }
        }

        // ── the plane at the head ──
        const i = Math.min(Math.floor(prog), S - 1);
        const f = prog - i;
        const head = samplePt(i, f);
        const ahead = samplePt(i, Math.min(1, f + 0.04));
        const ang = Math.atan2(ahead.y - head.y, ahead.x - head.x);
        drawPlane(head.x, head.y, ang, acc);
      }

      // ── vignette ──
      ctx.globalCompositeOperation = "source-over";
      const vg = ctx.createLinearGradient(0, 0, 0, h);
      vg.addColorStop(0, "rgba(4,6,13,0.55)");
      vg.addColorStop(0.18, "rgba(4,6,13,0)");
      vg.addColorStop(0.82, "rgba(4,6,13,0)");
      vg.addColorStop(1, "rgba(4,6,13,0.6)");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);

      // Refresh hit-test targets every frame — empty when no route is drawn.
      hubPosRef.current = hubPos;

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);

    // shared hit-test → the hub nearest the cursor (within its radius)
    const hitTest = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      return nearestHub(hubPosRef.current, clientX - rect.left, clientY - rect.top);
    };
    const toNode = (hp: HubHit | null): HoverNode | null =>
      hp ? { id: hp.id, label: hp.label, kind: hp.kind, x: hp.x, y: hp.y } : null;

    // hover hit-testing → emit the node under the cursor
    const onMove = (e: PointerEvent) => {
      const best = hitTest(e.clientX, e.clientY);
      canvas.style.cursor = best ? "pointer" : "default";
      stateRef.current.onHover?.(toNode(best));
    };
    const onLeave = () => stateRef.current.onHover?.(null);
    // click → select the node (or clear when clicking empty space)
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

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, ww: number, hh: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + ww, y, x + ww, y + hh, r);
  ctx.arcTo(x + ww, y + hh, x, y + hh, r);
  ctx.arcTo(x, y + hh, x, y, r);
  ctx.arcTo(x, y, x + ww, y, r);
  ctx.closePath();
}
