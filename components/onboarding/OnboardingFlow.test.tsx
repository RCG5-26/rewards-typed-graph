// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import OnboardingFlow from "./OnboardingFlow";

const sampleCard = {
  id: "card-1",
  slug: "chase-sapphire",
  name: "Chase Sapphire",
  issuer: "Chase",
  programName: "Chase UR",
  annualFeeCents: 9_500,
  firstYearValueCents: 120_000,
  imageUrl: null,
};

const sampleGraph = {
  user: {
    id: "u1",
    clerkId: "ck1",
    email: null,
    displayName: "Alex Demo",
    imageUrl: null,
    isDemoPersona: true,
  },
  balances: [
    {
      programId: "p1",
      programName: "Chase UR",
      currencyName: "points",
      balancePoints: 120_000,
    },
  ],
  goals: [],
  holds: [],
};

// Interactive stubs: the real CardTile/AgentConsole are exercised elsewhere;
// here we only need clickable affordances to drive the cards -> ask -> plan ->
// restart flow that owns `handleRestart`.
vi.mock("./AgentConsole", () => ({
  default: ({ onRestart }: { onRestart: () => void }) => (
    <button type="button" data-testid="restart" onClick={onRestart}>
      start over
    </button>
  ),
}));

vi.mock("./CardTile", () => ({
  default: ({
    card,
    onToggle,
  }: {
    card: { id: string; name: string };
    onToggle: (id: string) => void;
  }) => (
    <button
      type="button"
      data-testid={`card-${card.id}`}
      onClick={() => onToggle(card.id)}
    >
      {card.name}
    </button>
  ),
}));

vi.mock("./TopBar", () => ({
  default: () => <div data-testid="top-bar" />,
}));

function mockFetchSequence(
  mePayload: unknown,
  options: { cardsOk?: boolean } = {},
) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/cards") {
      if (options.cardsOk === false) {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ cards: [sampleCard] }),
      });
    }
    if (url === "/api/me") {
      return Promise.resolve({
        ok: true,
        json: async () => mePayload,
      });
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("OnboardingFlow bootstrap", () => {
  it("does not crash and shows no greeting when /api/me returns an identity-only payload", async () => {
    mockFetchSequence({ userId: "u1", clerkId: "ck1", seeded: true });
    render(<OnboardingFlow />);
    await waitFor(() => {
      expect(screen.getByTestId("top-bar")).toBeTruthy();
    });
    // The isUserGraph guard rejects the session payload, so `me` stays null and
    // the "welcome back" greeting must not appear.
    expect(screen.queryByText(/welcome back/i)).toBeNull();
  });

  it("renders without a greeting when /api/me responds non-ok", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/cards") {
        return Promise.resolve({ ok: true, json: async () => ({ cards: [sampleCard] }) });
      }
      if (url === "/api/me") {
        return Promise.resolve({ ok: false, status: 403, json: async () => ({}) });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<OnboardingFlow />);
    await waitFor(() => {
      expect(screen.getByTestId("top-bar")).toBeTruthy();
    });
    expect(screen.queryByText(/welcome back/i)).toBeNull();
  });

  it("renders a greeting when /api/me returns a UserGraph", async () => {
    mockFetchSequence(sampleGraph);
    render(<OnboardingFlow />);
    await waitFor(() => {
      expect(screen.getByText(/welcome back, alex/i)).toBeTruthy();
    });
  });

  it("still renders when /api/cards fails but /api/me succeeds", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/cards") {
        return Promise.reject(new Error("cards down"));
      }
      if (url === "/api/me") {
        return Promise.resolve({ ok: true, json: async () => sampleGraph });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<OnboardingFlow />);
    await waitFor(() => {
      expect(screen.getByText(/could not load your cards/i)).toBeTruthy();
    });
  });
});

type FetchCall = { url: string; method?: string };

/**
 * Records every fetch and resolves `/api/cards` + `/api/me` happily while the
 * caller controls how `/api/demo/reset` behaves. Returns the call log so tests
 * can assert the reset POST fired and the graph was refetched.
 */
function mockResetFetch(reset: () => Promise<unknown>): FetchCall[] {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: { method?: string }) => {
    const url = String(input);
    calls.push({ url, method: init?.method });
    if (url === "/api/cards") {
      return Promise.resolve({ ok: true, json: async () => ({ cards: [sampleCard] }) });
    }
    if (url === "/api/me") {
      return Promise.resolve({ ok: true, json: async () => sampleGraph });
    }
    if (url === "/api/demo/reset") {
      return reset();
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

/** Drives the flow cards -> ask -> plan and returns the AgentConsole restart button. */
async function driveToPlanStep(): Promise<HTMLElement> {
  render(<OnboardingFlow />);
  fireEvent.click(await screen.findByTestId("card-card-1"));
  fireEvent.click(screen.getByRole("button", { name: /^continue/i }));
  const textarea = await screen.findByLabelText(/describe what you want/i);
  fireEvent.change(textarea, { target: { value: "fly to tokyo" } });
  fireEvent.click(screen.getByRole("button", { name: /plan it/i }));
  return screen.findByTestId("restart");
}

describe("OnboardingFlow demo reset", () => {
  it("POSTs /api/demo/reset, refetches the graph, and returns to cards on success", async () => {
    const calls = mockResetFetch(() => Promise.resolve({ ok: true, json: async () => ({}) }));
    const restart = await driveToPlanStep();

    fireEvent.click(restart);

    await waitFor(() => {
      expect(
        calls.some((c) => c.url === "/api/demo/reset" && c.method === "POST"),
      ).toBe(true);
    });
    // Returned to the cards step (AgentConsole/restart no longer mounted).
    await waitFor(() => expect(screen.queryByTestId("restart")).toBeNull());
    // The graph is refetched so balances/greeting aren't stale: /api/me runs
    // once on bootstrap and again after the reset.
    expect(calls.filter((c) => c.url === "/api/me").length).toBeGreaterThanOrEqual(2);
  });

  it("surfaces an error but still returns to cards when reset responds non-ok", async () => {
    mockResetFetch(() => Promise.resolve({ ok: false, status: 500, json: async () => ({}) }));
    const restart = await driveToPlanStep();

    fireEvent.click(restart);

    await waitFor(() =>
      expect(screen.getByText(/could not reset/i)).toBeTruthy(),
    );
    expect(screen.queryByTestId("restart")).toBeNull();
  });

  it("surfaces an error and still resets when the reset request throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockResetFetch(() => Promise.reject(new Error("network down")));
    const restart = await driveToPlanStep();

    fireEvent.click(restart);

    await waitFor(() =>
      expect(screen.getByText(/could not reset/i)).toBeTruthy(),
    );
    expect(screen.queryByTestId("restart")).toBeNull();
    errorSpy.mockRestore();
  });
});
