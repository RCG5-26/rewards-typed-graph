import { describe, it, expect } from "vitest";
import { dollars } from "./comparison";

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
