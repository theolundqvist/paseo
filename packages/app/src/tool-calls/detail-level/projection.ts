import type { StreamItem } from "@/types/stream";
import type { ToolCallDetailLevel } from "@/hooks/use-settings/storage";
import {
  groupLiveToolCalls,
  prepareGroupedHistory,
  type GroupedHistory,
  type GroupedToolCalls,
  type ToolCallGroupingOptions,
} from "./grouping";
import { buildOverviewGroup, type OverviewToolCallGroup } from "./overview/model";

export type { ToolCallDetailLevel } from "@/hooks/use-settings/storage";
export type ToolCallDetailGroup = OverviewToolCallGroup;

export interface PreparedToolCallHistory {
  mode: "overview";
  options: ToolCallGroupingOptions;
  grouped: GroupedHistory<ToolCallDetailGroup>;
}

export interface ToolCallDetailProjection extends GroupedToolCalls<ToolCallDetailGroup> {}

const EMPTY_TOOL_CALL_GROUPS = new Map<string, ToolCallDetailGroup>();

// Approval UI owns pending plan presentation. Retain the canonical tool in the
// stream model so resolving it can reveal a card at its original position.
const visibleItemsCache = new WeakMap<StreamItem[], StreamItem[]>();
const compactVisibleItemsCache = new WeakMap<StreamItem[], StreamItem[]>();
function visibleToolCallItems(items: StreamItem[], compact = false): StreamItem[] {
  const cache = compact ? compactVisibleItemsCache : visibleItemsCache;
  const cached = cache.get(items);
  if (cached) return cached;
  const visible = items.filter((item) => {
    if (compact && item.kind === "assistant_message" && !item.text.trim()) return false;
    if (item.kind !== "tool_call" || item.payload.source !== "agent") return true;
    const data = item.payload.data;
    return (
      data.name !== "ExitPlanMode" && !(data.name === "plan_approval" && data.status === "running")
    );
  });
  const result = visible.length === items.length ? items : visible;
  cache.set(items, result);
  return result;
}

export function prepareToolCallHistory(
  level: ToolCallDetailLevel,
  tail: StreamItem[],
  options: ToolCallGroupingOptions = {},
): PreparedToolCallHistory | null {
  if (level === "detailed" && !options.compact) {
    return null;
  }
  return {
    mode: "overview",
    options,
    grouped: prepareGroupedHistory({
      tail: visibleToolCallItems(tail, options.compact),
      options,
      buildGroup: buildOverviewGroup,
    }),
  };
}

export function projectToolCallDetailLevel(input: {
  level: ToolCallDetailLevel;
  tail: StreamItem[];
  head: StreamItem[];
  preparedHistory: PreparedToolCallHistory | null;
  isTurnActive: boolean;
  compact?: boolean;
}): ToolCallDetailProjection {
  if (input.level === "detailed" && !input.compact) {
    return {
      tail: visibleToolCallItems(input.tail),
      head: visibleToolCallItems(input.head),
      groupsByHostId: EMPTY_TOOL_CALL_GROUPS,
      historyGroupUpdatesByHostId: EMPTY_TOOL_CALL_GROUPS,
    };
  }
  const mode = input.compact ? "overview" : input.level;
  if (!input.preparedHistory || input.preparedHistory.mode !== mode) {
    throw new Error(`Missing prepared ${input.level} tool call history`);
  }
  return groupLiveToolCalls({
    history: input.preparedHistory.grouped,
    head: visibleToolCallItems(input.head, input.compact),
    options: input.preparedHistory.options,
    isTurnActive: input.isTurnActive,
    buildGroup: buildOverviewGroup,
  });
}
