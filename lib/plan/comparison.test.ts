import { describe, it, expect } from "vitest";
import { deriveComparison, dollars, fmtTokens } from "./comparison";
import type { LiveMetrics } from "./comparison";

const baseline: LiveMetrics = {
  planValueCents: 10000,
  opCount: 5,
  invalidationCaught: false,
  revision: 1,
};

describe("deriveComparison", () => {
  it("returns typed tokens = base + opCount * perOp", () => {
    const result = deriveComparison(baseline);
    // TOKENS.base=1200, TOKENS.perOp=350 → 1200 + 5*350 = 2950
    expect(result.typed.tokens).toBe(2950);
  });

  it("returns typed valueCents equal to planValueCents", () => {
    const result = deriveComparison(baseline);
    expect(result.typed.valueCents).toBe(10000);
  });

  it("crewai overstates value by 1.25x", () => {
    const result = deriveComparison(baseline);
    expect(result.crewai.valueCents).toBe(12500);
  });

  it("single undershoots value at 0.7x", () => {
    const result = deriveComparison(baseline);
    expect(result.single.valueCents).toBe(7000);
  });

  it("crewai inflates tokens by 2.8x", () => {
    const result = deriveComparison(baseline);
    expect(result.crewai.tokens).toBe(Math.round(2950 * 2.8));
  });

  it("single inflates tokens by 2.0x", () => {
    const result = deriveComparison(baseline);
    expect(result.single.tokens).toBe(Math.round(2950 * 2.0));
  });

  it("clamps negative opCount to zero", () => {
    const result = deriveComparison({ ...baseline, opCount: -10 });
    // Math.max(0, -10) = 0 → tokens = TOKENS.base = 1200
    expect(result.typed.tokens).toBe(1200);
  });

  it("handles planValueCents=0 without throwing", () => {
    const result = deriveComparison({ ...baseline, planValueCents: 0 });
    expect(result.typed.valueCents).toBe(0);
    expect(result.crewai.valueCents).toBe(0);
    expect(result.single.valueCents).toBe(0);
  });

  it("token derivation is independent of planValueCents", () => {
    const withValue = deriveComparison(baseline);
    const withZero = deriveComparison({ ...baseline, planValueCents: 0 });
    expect(withValue.typed.tokens).toBe(withZero.typed.tokens);
  });
});

describe("fmtTokens", () => {
  it("formats thousands with one decimal", () => {
    // 4350/1000 = 4.349... in IEEE 754 → rounds down to 4.3
    expect(fmtTokens(4350)).toBe("4.3k");
  });

  it("rounds down correctly", () => {
    expect(fmtTokens(1200)).toBe("1.2k");
  });

  it("handles zero", () => {
    expect(fmtTokens(0)).toBe("0.0k");
  });
});

describe("dollars", () => {
  it("renders an em dash for zero (no misleading $0)", () => {
    expect(dollars(0)).toBe("—");
  });

  it("renders whole dollars from cents", () => {
    expect(dollars(12000)).toBe("$120");
  });

  it("groups thousands", () => {
    expect(dollars(123456700)).toBe("$1,234,567");
  });

  it("rounds to the nearest dollar", () => {
    expect(dollars(12049)).toBe("$120");
    expect(dollars(12050)).toBe("$121");
  });
});
