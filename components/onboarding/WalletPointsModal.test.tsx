// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import WalletPointsModal from "./WalletPointsModal";
import type { CardView } from "@/lib/cards/types";

const card = (over: Partial<CardView> = {}): CardView => ({
  id: "card-1",
  slug: "chase-sapphire",
  name: "Chase Sapphire",
  bank: "Chase",
  network: "Visa",
  annualFeeCents: 9_500,
  programName: "Chase Ultimate Rewards",
  currencyName: "points",
  signupBonusPoints: 60_000,
  rate: "3×",
  firstYearValueCents: 120_000,
  face: "#101828",
  accent: "#7da6ff",
  ...over,
});

afterEach(cleanup);

describe("WalletPointsModal", () => {
  it("sanitizes input to digits only", () => {
    render(<WalletPointsModal cards={[card()]} onClose={() => {}} onSubmit={async () => {}} />);
    const input = screen.getByLabelText(/points on chase sapphire/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "12a3,4" } });
    expect(input.value).toBe("1234");
  });

  it("closes via the close button, backdrop, and Escape", () => {
    const onClose = vi.fn();
    render(<WalletPointsModal cards={[card()]} onClose={onClose} onSubmit={async () => {}} />);

    // Two "Close" affordances: the backdrop and the × button.
    const closers = screen.getAllByRole("button", { name: /close/i });
    fireEvent.click(closers[0]);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("submits only the cards that were actually filled in (blank fields omitted)", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(
      <WalletPointsModal
        cards={[card({ id: "a", name: "Card A" }), card({ id: "b", name: "Card B" })]}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.change(screen.getByLabelText(/points on card a/i), { target: { value: "5000" } });
    // Card B left blank.
    fireEvent.click(screen.getByRole("button", { name: /save points/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({ a: 5000 });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("disables closing while submitting", async () => {
    let resolve: (() => void) | undefined;
    const onSubmit = vi.fn(() => new Promise<void>((r) => (resolve = () => r())));
    const onClose = vi.fn();
    render(<WalletPointsModal cards={[card()]} onClose={onClose} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/points on chase sapphire/i), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: /save points/i }));

    // Mid-submit: the button shows the saving state and close is a no-op.
    await waitFor(() => expect(screen.getByRole("button", { name: /saving/i })).toBeInTheDocument());
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getAllByRole("button", { name: /close/i })[0]);
    expect(onClose).not.toHaveBeenCalled();

    resolve?.();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
