import type { ChatScrollState } from "./chat-scroll-state";

export type PrCockpitCollapseState =
  | { kind: "manual-collapsed" }
  | { kind: "auto"; expandedAwayRevision: number | null };

export const INITIAL_COLLAPSE_STATE: PrCockpitCollapseState = {
  kind: "auto",
  expandedAwayRevision: null,
};

export function isPrCockpitCollapsed(
  state: PrCockpitCollapseState,
  scroll: ChatScrollState,
): boolean {
  return (
    state.kind === "manual-collapsed" ||
    (scroll.isAwayFromLatest && state.expandedAwayRevision !== scroll.revision)
  );
}

export function togglePrCockpitCollapsed(
  state: PrCockpitCollapseState,
  scroll: ChatScrollState,
): PrCockpitCollapseState {
  return isPrCockpitCollapsed(state, scroll)
    ? { kind: "auto", expandedAwayRevision: scroll.isAwayFromLatest ? scroll.revision : null }
    : { kind: "manual-collapsed" };
}
