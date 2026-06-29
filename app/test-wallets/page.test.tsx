// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// Mock the server-only client (so its `import "server-only"` never loads) and
// stub the heavy interactive child — this test covers the page shell + states.
vi.mock("@/lib/comparison/client", () => ({ getTestWallets: vi.fn() }));
vi.mock("@/components/comparison/TestWalletComparison", () => ({
  TestWalletComparison: ({ wallets }: { wallets: unknown[] }) => (
    <div data-testid="comparison" data-count={wallets.length} />
  ),
}));

const TestWalletsPage = (await import("./page")).default;
const { getTestWallets } = await import("@/lib/comparison/client");
const mockGetTestWallets = vi.mocked(getTestWallets);

beforeEach(() => mockGetTestWallets.mockReset());
afterEach(cleanup);

describe("/test-wallets page", () => {
  it("renders the header and the comparison when facts load", async () => {
    mockGetTestWallets.mockResolvedValue({
      wallets: [{ walletId: "transfer-required" }] as never,
    });
    render(await TestWalletsPage());

    expect(screen.getByText(/Test Wallets — Architecture Comparison/i)).toBeInTheDocument();
    expect(screen.getByText(/three architectures run independently/i)).toBeInTheDocument();
    const comparison = screen.getByTestId("comparison");
    expect(comparison).toBeInTheDocument();
    expect(comparison.getAttribute("data-count")).toBe("1");
  });

  it("renders the loadError state when the API call throws", async () => {
    // Throw on call (not an eagerly-created rejected promise) so the page's
    // try/catch consumes it without a spurious unhandled-rejection.
    mockGetTestWallets.mockImplementation(async () => {
      throw new Error("API down");
    });
    render(await TestWalletsPage());

    expect(screen.getByText(/Could not load test wallets from the API/i)).toBeInTheDocument();
    expect(screen.queryByTestId("comparison")).toBeNull();
  });
});
