import { describe, expect, it } from "vitest";
import { createChatScrollStore } from "./chat-scroll-state";
import {
  INITIAL_COLLAPSE_STATE,
  isPrCockpitCollapsed,
  togglePrCockpitCollapsed,
} from "./collapse-state";

const latest = { isAwayFromLatest: false, revision: 0 };
const away = { isAwayFromLatest: true, revision: 1 };
const returned = { isAwayFromLatest: false, revision: 2 };
const awayAgain = { isAwayFromLatest: true, revision: 3 };

describe("PR Cockpit collapse state", () => {
  it("expands at the latest messages and collapses while reading history", () => {
    expect(isPrCockpitCollapsed(INITIAL_COLLAPSE_STATE, latest)).toBe(false);
    expect(isPrCockpitCollapsed(INITIAL_COLLAPSE_STATE, away)).toBe(true);
    expect(isPrCockpitCollapsed(INITIAL_COLLAPSE_STATE, returned)).toBe(false);
  });

  it("preserves a manual collapse after scrolling away and returning", () => {
    const collapsed = togglePrCockpitCollapsed(INITIAL_COLLAPSE_STATE, latest);
    expect(isPrCockpitCollapsed(collapsed, away)).toBe(true);
    expect(isPrCockpitCollapsed(collapsed, returned)).toBe(true);
    expect(isPrCockpitCollapsed(togglePrCockpitCollapsed(collapsed, returned), returned)).toBe(
      false,
    );
  });

  it("allows expansion while reading history, but collapses on the next departure", () => {
    const expanded = togglePrCockpitCollapsed(INITIAL_COLLAPSE_STATE, away);
    expect(isPrCockpitCollapsed(expanded, away)).toBe(false);
    expect(isPrCockpitCollapsed(expanded, returned)).toBe(false);
    expect(isPrCockpitCollapsed(expanded, awayAgain)).toBe(true);
  });

  it("can manually collapse again while reading history", () => {
    const expanded = togglePrCockpitCollapsed(INITIAL_COLLAPSE_STATE, away);
    const collapsed = togglePrCockpitCollapsed(expanded, away);
    expect(isPrCockpitCollapsed(collapsed, away)).toBe(true);
    expect(isPrCockpitCollapsed(collapsed, returned)).toBe(true);
  });
});

describe("pane-scoped chat scroll signal", () => {
  it("changes revisions only when the viewport leaves or returns to latest", () => {
    const store = createChatScrollStore();
    store.getState().report("host:agent", false);
    expect(store.getState().bySession.size).toBe(0);
    store.getState().report("host:agent", true);
    expect(store.getState().bySession.get("host:agent")).toEqual(away);
    const snapshot = store.getState();
    store.getState().report("host:agent", true);
    expect(store.getState()).toBe(snapshot);
    store.getState().report("host:agent", false);
    expect(store.getState().bySession.get("host:agent")).toEqual(returned);
    store.getState().report("host:agent", true);
    expect(store.getState().bySession.get("host:agent")).toEqual(awayAgain);
  });

  it("isolates agents, servers, and panes and removes unmounted view state", () => {
    const pane = createChatScrollStore();
    const otherPane = createChatScrollStore();
    pane.getState().report("host:agent", true);
    pane.getState().report("other-host:agent", true);
    expect(pane.getState().bySession.has("host:other-agent")).toBe(false);
    expect(otherPane.getState().bySession.size).toBe(0);
    pane.getState().remove("host:agent");
    expect(pane.getState().bySession.has("host:agent")).toBe(false);
    expect(pane.getState().bySession.get("other-host:agent")).toEqual(away);
  });
});
