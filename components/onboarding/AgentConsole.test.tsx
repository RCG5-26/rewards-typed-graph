// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import AgentConsole from "./AgentConsole";

/** Minimal EventSource stub: capture listeners so tests can drive SSE events. */
class MockEventSource {
  static last: MockEventSource | null = null;
  listeners: Record<string, ((ev: { data: string }) => void)[]> = {};
  closed = false;
  constructor(public url: string) {
    MockEventSource.last = this;
  }
  addEventListener(type: string, cb: (ev: { data: string }) => void) {
    (this.listeners[type] ??= []).push(cb);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown) {
    for (const cb of this.listeners[type] ?? []) cb({ data: JSON.stringify(data) });
  }
}

const meta = (overrides: Record<string, unknown> = {}) => ({
  steps: [],
  liveNodes: 1,
  route: "Chase UR → Hyatt",
  goalLabel: "specific redemption",
  revision: 1,
  planValueCents: 12000,
  graph: {
    nodes: [{ id: "n1", label: "Chase UR", kind: "program", col: 0, state: "active" }],
    edges: [],
  },
  ...overrides,
});

const step = (type: string, order: number) => ({
  order,
  agentType: "redemption_agent",
  type,
  title: `step ${order}`,
  reasoning: "because",
  status: "current",
  deps: [],
});

const emit = (type: string, data: unknown) => act(() => MockEventSource.last?.emit(type, data));

beforeEach(() => {
  vi.stubGlobal("EventSource", MockEventSource);
  // jsdom lacks matchMedia; TypedGraph's useReducedMotion needs it.
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
  MockEventSource.last = null;
});

const BAL = [
  { programId: "prog-chase", programName: "Chase UR", currencyName: "points", balancePoints: 180000 },
  { programId: "prog-hyatt", programName: "World of Hyatt", currencyName: "points", balancePoints: 30000 },
];
const BAL_AFTER = [
  { programId: "prog-chase", programName: "Chase UR", currencyName: "points", balancePoints: 150000 },
  { programId: "prog-hyatt", programName: "World of Hyatt", currencyName: "points", balancePoints: 60000 },
];
const userGraph = (balances: typeof BAL) => ({
  user: {
    id: "u1",
    clerkId: "clerk_u1",
    email: null,
    displayName: "Hero",
    imageUrl: null,
    isDemoPersona: true,
  },
  balances,
  goals: [],
  holds: [],
});

const namedStep = (type: string, order: number, title: string) => ({
  order,
  agentType: "redemption_agent",
  type,
  title,
  reasoning: "because",
  status: "current",
  deps: [],
});

function renderConsole(balances: typeof BAL = []) {
  return render(
    <AgentConsole
      queryText="best redemption"
      selectedCardIds={[]}
      onRestart={() => {}}
      balances={balances}
    />,
  );
}

/** Drive the initial stream to a completed `current` plan with the given steps. */
function completeInitialPlan(steps: ReturnType<typeof namedStep>[]) {
  emit("meta", meta({ steps }));
  emit("done", { status: "current", planValueCents: 12000, route: "Chase UR → Hyatt" });
}

describe("AgentConsole", () => {
  it("exposes a keyboard-accessible list of graph nodes once they stream in", () => {
    renderConsole();
    emit("meta", meta());
    expect(screen.getByRole("button", { name: /view details for chase ur/i })).toBeTruthy();
  });

  it("labels the console as an illustrative preview with truthful metric names", () => {
    renderConsole(BAL);
    // The console is not a live run against the user's wallet — say so.
    expect(screen.getByText(/Illustrative Plan Preview/i)).toBeTruthy();
    // Metrics relabeled truthfully (no '/yr' on a one-time redemption; the
    // token figure is framed as model usage vs an illustrative baseline).
    expect(screen.getByText(/estimated redemption value/i)).toBeTruthy();
    expect(screen.getByText(/model usage/i)).toBeTruthy();
    // The typed graph is deterministic — 0 model tokens, never a fabricated cost.
    expect(screen.getByText(/deterministic specialists, no LLM call/i)).toBeTruthy();
    // The primary forward action is the live comparison.
    expect(screen.getByText(/Compare planners live/i)).toBeTruthy();
  });

  it("opens and closes the node-detail popover from the keyboard list", () => {
    renderConsole();
    emit("meta", meta());

    fireEvent.click(screen.getByRole("button", { name: /view details for chase ur/i }));
    expect(screen.getByRole("dialog", { name: /chase ur details/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders the direct RouteBar when the plan has no transfer step", () => {
    renderConsole();
    emit("meta", meta({ steps: [step("redemption_recommendation", 1)] }));

    expect(screen.getByText("Hyatt Points")).toBeTruthy();
    expect(screen.getByText(/book hotel directly · no transfer needed/i)).toBeTruthy();
    expect(screen.queryByText("Chase UR")).toBeNull();
  });

  it("renders the entered-balances panel in the plan card when balances are present", () => {
    renderConsole(BAL);
    completeInitialPlan([namedStep("redemption_recommendation", 1, "Book it")]);

    // The facts panels start collapsed on the plan step; open the disclosure.
    fireEvent.click(screen.getByRole("button", { name: /what the agents see/i }));

    expect(screen.getByText("your points · what the agents see")).toBeTruthy();
    // The panel surfaces the seeded liveBalances (programName + formatted points).
    expect(screen.getByText("Chase UR")).toBeTruthy();
    expect(screen.getByText("180,000")).toBeTruthy();
  });

  it("omits the balances panel when there are no balances", () => {
    renderConsole();
    completeInitialPlan([namedStep("redemption_recommendation", 1, "Book it")]);

    expect(screen.queryByText("your points · what the agents see")).toBeNull();
  });

  it("renders the transfer RouteBar when the plan contains a transfer step", () => {
    renderConsole();
    emit(
      "meta",
      meta({
        steps: [step("transfer_recommendation", 1), step("redemption_recommendation", 2)],
      }),
    );

    expect(screen.getByText("Chase UR")).toBeTruthy();
    expect(screen.getByText("World of Hyatt")).toBeTruthy();
    expect(screen.getByText(/book hotel with transferred points/i)).toBeTruthy();
  });

  // ── user-driven replan ("I transferred points") ──

  it("shows the transfer control only when balances are available", () => {
    renderConsole();
    completeInitialPlan([namedStep("redemption_recommendation", 1, "Book Ginza")]);
    expect(screen.queryByRole("button", { name: /i transferred points/i })).toBeNull();

    cleanup();
    renderConsole(BAL);
    completeInitialPlan([namedStep("redemption_recommendation", 1, "Book Ginza")]);
    expect(screen.getByRole("button", { name: /i transferred points/i })).toBeTruthy();
  });

  it("rejects a same-source/destination transfer without starting a replan", () => {
    renderConsole(BAL);
    completeInitialPlan([namedStep("redemption_recommendation", 1, "Book Ginza")]);
    fireEvent.click(screen.getByRole("button", { name: /i transferred points/i }));

    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "prog-chase" } });
    fireEvent.change(selects[1], { target: { value: "prog-chase" } });
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "5000" } });
    const urlBefore = MockEventSource.last?.url;
    fireEvent.click(screen.getByRole("button", { name: /apply & re-plan/i }));

    expect(screen.getByRole("alert")).toHaveTextContent(/must differ/i);
    expect(MockEventSource.last?.url).toBe(urlBefore); // no new stream opened
  });

  it("rejects an amount over the available balance", () => {
    renderConsole(BAL);
    completeInitialPlan([namedStep("redemption_recommendation", 1, "Book Ginza")]);
    fireEvent.click(screen.getByRole("button", { name: /i transferred points/i }));

    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "prog-chase" } });
    fireEvent.change(selects[1], { target: { value: "prog-hyatt" } });
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "999999999" } });
    fireEvent.click(screen.getByRole("button", { name: /apply & re-plan/i }));

    expect(screen.getByRole("alert")).toHaveTextContent(/available/i);
  });

  it("forwards the transfer as query params and renders the replan summary", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => userGraph(BAL_AFTER) })),
    );
    renderConsole(BAL);
    completeInitialPlan([
      namedStep("transfer_recommendation", 1, "Transfer 45k to Hyatt"),
      namedStep("redemption_recommendation", 2, "Book Ginza"),
    ]);

    fireEvent.click(screen.getByRole("button", { name: /i transferred points/i }));
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "prog-chase" } });
    fireEvent.change(selects[1], { target: { value: "prog-hyatt" } });
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "30000" } });
    fireEvent.click(screen.getByRole("button", { name: /apply & re-plan/i }));

    // The replan stream carries the user transfer as query params.
    expect(MockEventSource.last?.url).toContain("replan=1");
    expect(MockEventSource.last?.url).toContain("src=prog-chase");
    expect(MockEventSource.last?.url).toContain("dest=prog-hyatt");
    expect(MockEventSource.last?.url).toContain("amt=30000");

    // Revision 2 drops the transfer step.
    emit("meta", meta({ steps: [namedStep("redemption_recommendation", 1, "Book Ginza")], revision: 2 }));
    await act(async () => {
      MockEventSource.last?.emit("done", { status: "current", planValueCents: 18000, route: "Hyatt direct" });
      await Promise.resolve();
    });

    expect(await screen.findByText(/revision 1 · superseded/i)).toBeTruthy();
    expect(screen.getByText(/revision 2 · current/i)).toBeTruthy();
    // removed transfer step + real before→after balance deltas from /api/me
    expect(screen.getByText("Transfer 45k to Hyatt")).toBeTruthy();
    expect(screen.getByText(/180,000 → 150,000/)).toBeTruthy();
    expect(screen.getByText(/30,000 → 60,000/)).toBeTruthy();
  });

  it("preserves an explicit zero plan value instead of keeping a stale value", () => {
    renderConsole();
    emit("meta", meta({ planValueCents: 12000 }));
    expect(screen.getAllByText("$120").length).toBeGreaterThan(0);

    // A later revision resolves to 0 — the UI must reflect it, not keep "$120".
    emit("meta", meta({ planValueCents: 0, revision: 2 }));
    expect(screen.queryByText("$120")).toBeNull();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
