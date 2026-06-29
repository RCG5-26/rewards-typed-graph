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

    // Header now follows the onboarding pattern: a mono eyebrow + a light h1.
    expect(screen.getByText(/architecture comparison/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /test wallets/i })).toBeInTheDocument();
    expect(screen.getByText(/three architectures run independently/i)).toBeInTheDocument();
    const comparison = screen.getByTestId("comparison");
    expect(comparison).toBeInTheDocument();
    expect(comparison.getAttribute("data-count")).toBe("1");
  });

  it("renders the loadError state when the API call throws", async () => {
    mockGetTestWallets.mockRejectedValue(new Error("API down"));
    render(await TestWalletsPage());

    expect(screen.getByText(/Could not load test wallets from the API/i)).toBeInTheDocument();
    expect(screen.queryByTestId("comparison")).toBeNull();
  });
});
