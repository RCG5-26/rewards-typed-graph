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

function renderConsole() {
  return render(
    <AgentConsole queryText="best redemption" selectedCardIds={[]} onRestart={() => {}} />,
  );
}

describe("AgentConsole", () => {
  it("exposes a keyboard-accessible list of graph nodes once they stream in", () => {
    renderConsole();
    emit("meta", meta());
    expect(screen.getByRole("button", { name: /view details for chase ur/i })).toBeTruthy();
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
