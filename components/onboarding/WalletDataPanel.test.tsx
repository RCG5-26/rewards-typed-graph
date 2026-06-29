// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import WalletDataPanel from "./WalletDataPanel";

const balance = (over: Partial<Parameters<typeof WalletDataPanel>[0]["balances"][number]> = {}) => ({
  programId: "p1",
  programName: "Chase Ultimate Rewards",
  currencyName: "points",
  balancePoints: 120_000,
  ...over,
});

afterEach(cleanup);

describe("WalletDataPanel", () => {
  it("renders nothing when there are no balances", () => {
    const { container } = render(<WalletDataPanel balances={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the header total summed from balancePoints", () => {
    render(
      <WalletDataPanel
        balances={[
          balance({ programId: "p1", balancePoints: 120_000 }),
          balance({ programId: "p2", programName: "World of Hyatt", balancePoints: 30_000 }),
        ]}
      />,
    );
    // 120,000 + 30,000 = 150,000 pts total
    expect(screen.getByText("150,000")).toBeInTheDocument();
  });

  it("formats each program row with name, points, and currency", () => {
    render(
      <WalletDataPanel
        balances={[balance({ programName: "United MileagePlus", balancePoints: 30_000, currencyName: "miles" })]}
      />,
    );
    expect(screen.getByText("United MileagePlus")).toBeInTheDocument();
    // With a single balance the header total and the row both read "30,000".
    expect(screen.getAllByText("30,000").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("miles")).toBeInTheDocument();
  });

  it("uses the provided title", () => {
    render(<WalletDataPanel balances={[balance()]} title="your points" />);
    expect(screen.getByText("your points")).toBeInTheDocument();
  });
});
