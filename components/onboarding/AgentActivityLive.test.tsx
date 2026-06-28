// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

import AgentActivityLive from "./AgentActivityLive";

/** Minimal EventSource stub capturing listeners so tests can drive SSE events. */
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
  emit(type: string, data?: unknown) {
    for (const cb of this.listeners[type] ?? []) cb({ data: JSON.stringify(data ?? {}) });
  }
}

const mut = (over: Record<string, unknown>) => ({
  target_table: null,
  target_node_id: null,
  plan_lineage_id: "lin-1",
  plan_id: "p1",
  summary: "",
  ...over,
});

beforeEach(() => {
  vi.stubGlobal("EventSource", MockEventSource);
  MockEventSource.last = null;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AgentActivityLive", () => {
  it("subscribes to the real mutations stream", () => {
    render(<AgentActivityLive />);
    expect(MockEventSource.last?.url).toMatch(/\/api\/mutations\/stream/);
  });

  it("starts in a loading state until the stream opens or emits", () => {
    render(<AgentActivityLive />);
    expect(screen.getByRole("status")).toHaveTextContent(/Loading/i);
  });

  it("renders streamed mutations as activity entries", () => {
    render(<AgentActivityLive />);
    act(() => {
      MockEventSource.last?.emit("graph_mutation", mut({ event_id: "1", mutation_type: "CreatePlan" }));
      MockEventSource.last?.emit(
        "graph_mutation",
        mut({ event_id: "2", mutation_type: "RecordStateDependency", summary: "dep" }),
      );
    });
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getByText(/Plan revision 1 committed/)).toBeInTheDocument();
  });

  it("drops replayed events with an already-seen event_id (no duplicate rows)", () => {
    render(<AgentActivityLive />);
    act(() => {
      MockEventSource.last?.emit("graph_mutation", mut({ event_id: "1", mutation_type: "CreatePlan" }));
      MockEventSource.last?.emit("graph_mutation", mut({ event_id: "1", mutation_type: "CreatePlan" }));
    });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("shows an error only if the stream errors before any event", () => {
    render(<AgentActivityLive />);
    act(() => MockEventSource.last?.emit("error"));
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("closes the EventSource on unmount", () => {
    const { unmount } = render(<AgentActivityLive />);
    const es = MockEventSource.last;
    unmount();
    expect(es?.closed).toBe(true);
  });
});
