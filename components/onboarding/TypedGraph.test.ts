import { describe, it, expect } from "vitest";
import { nearestHub, type HubHit } from "./TypedGraph";

const hub = (id: string, x: number, y: number, r = 10): HubHit => ({
  id,
  label: id,
  kind: "program",
  x,
  y,
  r,
});

describe("nearestHub", () => {
  it("returns null when there are no hubs (cleared route → no stale target)", () => {
    expect(nearestHub([], 50, 50)).toBeNull();
  });

  it("selects a hub when the point is inside its padded radius", () => {
    const hit = nearestHub([hub("a", 100, 100)], 105, 100);
    expect(hit?.id).toBe("a");
  });

  it("returns null when the point is outside every hit radius", () => {
    // bead r=10 → hit radius max(20, 26)=26; 200px away is well outside
    expect(nearestHub([hub("a", 100, 100)], 400, 400)).toBeNull();
  });

  it("picks the closest hub when several are in range", () => {
    const hubs = [hub("far", 100, 100), hub("near", 120, 100)];
    expect(nearestHub(hubs, 122, 100)?.id).toBe("near");
  });

  it("uses a 20px floor so tiny beads stay clickable", () => {
    // r=1 → 2.6 = 2.6, floored to 20; a point 15px away should still hit
    expect(nearestHub([hub("a", 100, 100, 1)], 115, 100)?.id).toBe("a");
  });
});
