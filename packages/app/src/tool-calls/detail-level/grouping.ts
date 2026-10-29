import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import type { StreamItem, ThoughtItem, ToolCallItem } from "@/types/stream";

export interface ToolCallDescriptor {
  detail: ToolCallDetail;
  name: string;
  status: "executing" | "running" | "completed" | "failed" | "canceled";
  error: unknown;
  metadata?: Record<string, unknown>;
}

export type ToolCallRunItem = ToolCallItem | ThoughtItem;

export interface ToolCallGroupingOptions {
  compact?: boolean;
  resolveRunId?: (calls: readonly ToolCallItem[]) => string;
}

// A page can start halfway through a run. Keep the already-mounted host when
// older calls are prepended, rather than losing its expansion and reading anchor.
export function createToolCallRunIdResolver() {
  const hostIds = new Set<string>();
  return (calls: readonly ToolCallItem[]): string => {
    const existingHost = calls.find((call) => hostIds.has(call.id));
    const id = existingHost ? existingHost.id : calls[0]!.id;
    hostIds.add(id);
    return id;
  };
}

export interface ToolCallRun {
  id: string;
  calls: readonly ToolCallItem[];
  items: readonly ToolCallRunItem[];
  latest: ToolCallItem;
  isSealed: boolean;
}

export interface GroupedHistory<TGroup> {
  tail: StreamItem[];
  groupsByHostId: Map<string, TGroup>;
  pendingItems: readonly ToolCallRunItem[];
}

export interface GroupedToolCalls<TGroup> {
  tail: StreamItem[];
  head: StreamItem[];
  groupsByHostId: ToolCallGroupLookup<TGroup>;
  historyGroupUpdatesByHostId: ToolCallGroupLookup<TGroup>;
}

export interface ToolCallGroupLookup<TGroup> {
  readonly size: number;
  get(id: string): TGroup | undefined;
  has(id: string): boolean;
}

const EMPTY_GROUPS = new Map<string, never>();

export function describeToolCall(item: ToolCallItem): ToolCallDescriptor {
  if (item.payload.source === "agent") {
    const { data } = item.payload;
    return {
      detail: data.detail,
      name: data.name,
      status: data.status,
      error: data.error,
      metadata: data.metadata,
    };
  }

  const { data } = item.payload;
  return {
    detail: {
      type: "unknown",
      input: data.arguments ?? null,
      output: data.result ?? null,
    },
    name: data.toolName,
    status: data.status,
    error: data.error,
  };
}

export function isGroupableToolCall(item: StreamItem): item is ToolCallItem {
  if (item.kind !== "tool_call") {
    return false;
  }
  const descriptor = describeToolCall(item);
  return descriptor.detail.type !== "plan" && descriptor.name.trim().toLowerCase() !== "speak";
}

function createRun(
  items: readonly ToolCallRunItem[],
  isSealed: boolean,
  options: ToolCallGroupingOptions,
): ToolCallRun {
  const calls = items.filter((item): item is ToolCallItem => item.kind === "tool_call");
  const first = calls[0];
  const latest = calls.at(-1);
  if (!first || !latest) {
    throw new Error("Cannot group an empty tool call run");
  }
  const id = options.resolveRunId ? options.resolveRunId(calls) : first.id;
  return { id, calls, items, latest, isSealed };
}

function createHost(run: ToolCallRun): ToolCallItem {
  if (run.latest.id === run.id) {
    return run.latest;
  }
  return { ...run.latest, id: run.id };
}

function isRunning(item: ToolCallRunItem): boolean {
  if (item.kind === "thought") return item.status === "loading";
  const status = describeToolCall(item).status;
  return status === "running" || status === "executing";
}

function continuesRun(
  item: StreamItem,
  pending: readonly ToolCallRunItem[],
  compact: boolean | undefined,
): item is ToolCallRunItem {
  return (
    isGroupableToolCall(item) || (compact === true && pending.length > 0 && item.kind === "thought")
  );
}

function appendRun<TGroup>(input: {
  items: readonly ToolCallRunItem[];
  options: ToolCallGroupingOptions;
  isSealed: boolean;
  output: StreamItem[];
  groups: Map<string, TGroup>;
  buildGroup: (run: ToolCallRun) => TGroup;
}): void {
  if (input.items.length === 0) {
    return;
  }
  const run = createRun(input.items, input.isSealed, input.options);
  const host = createHost(run);
  input.output.push(host);
  input.groups.set(host.id, input.buildGroup(run));
}

export function prepareGroupedHistory<TGroup>(input: {
  tail: StreamItem[];
  options?: ToolCallGroupingOptions;
  buildGroup: (run: ToolCallRun) => TGroup;
}): GroupedHistory<TGroup> {
  const output: StreamItem[] = [];
  const groups = new Map<string, TGroup>();
  let pending: ToolCallRunItem[] = [];
  const options = input.options ?? {};

  for (const item of input.tail) {
    if (continuesRun(item, pending, options.compact)) {
      pending.push(item);
      continue;
    }
    appendRun({
      items: pending,
      options,
      isSealed: true,
      output,
      groups,
      buildGroup: input.buildGroup,
    });
    pending = [];
    output.push(item);
  }

  appendRun({
    items: pending,
    options,
    isSealed: true,
    output,
    groups,
    buildGroup: input.buildGroup,
  });

  return {
    tail: groups.size > 0 ? output : input.tail,
    groupsByHostId: groups,
    pendingItems: pending,
  };
}

export function groupLiveToolCalls<TGroup>(input: {
  history: GroupedHistory<TGroup>;
  head: StreamItem[];
  isTurnActive: boolean;
  options?: ToolCallGroupingOptions;
  buildGroup: (run: ToolCallRun) => TGroup;
}): GroupedToolCalls<TGroup> {
  const head: StreamItem[] = [];
  const liveGroups = new Map<string, TGroup>();
  const options = input.options ?? {};
  let pending = [...input.history.pendingItems];
  let hostPlacement: "history" | "head" | null = pending.length > 0 ? "history" : null;
  let pendingIncludesHead = false;

  const flush = (isSealed: boolean) => {
    if (pending.length === 0) {
      return;
    }
    const run = createRun(pending, isSealed, options);
    if (hostPlacement === "head") {
      head.push(createHost(run));
    }
    if (hostPlacement === "head" || pendingIncludesHead || !isSealed) {
      liveGroups.set(run.id, input.buildGroup(run));
    }
    pending = [];
    hostPlacement = null;
    pendingIncludesHead = false;
  };

  for (const item of input.head) {
    if (continuesRun(item, pending, options.compact)) {
      if (pending.length === 0) {
        hostPlacement = "head";
      }
      pending.push(item);
      pendingIncludesHead = true;
      continue;
    }
    flush(true);
    head.push(item);
  }
  // Tool calls live in retained tail rather than the streaming head. The agent
  // lifecycle snapshot can still be idle while a newly received tool call is
  // already running, so its direct timeline status is the authoritative start
  // signal. The lifecycle state continues to keep completed calls live between
  // sequential tool updates.
  // Compact chat keeps the latest list open even after idle; only a visible
  // boundary makes it historical.
  const trailingRunIsActive = options.compact || input.isTurnActive || pending.some(isRunning);
  flush(!trailingRunIsActive);

  if (liveGroups.size === 0) {
    return {
      tail: input.history.tail,
      head: input.head,
      groupsByHostId: input.history.groupsByHostId,
      historyGroupUpdatesByHostId: EMPTY_GROUPS,
    };
  }
  if (input.history.groupsByHostId.size === 0) {
    return {
      tail: input.history.tail,
      head,
      groupsByHostId: liveGroups,
      historyGroupUpdatesByHostId: EMPTY_GROUPS,
    };
  }
  const groupsByHostId = new Map(input.history.groupsByHostId);
  let historyGroupUpdatesByHostId: Map<string, TGroup> | null = null;
  for (const [id, group] of liveGroups) {
    groupsByHostId.set(id, group);
    if (input.history.groupsByHostId.has(id)) {
      historyGroupUpdatesByHostId ??= new Map();
      historyGroupUpdatesByHostId.set(id, group);
    }
  }
  return {
    tail: input.history.tail,
    head,
    groupsByHostId,
    historyGroupUpdatesByHostId: historyGroupUpdatesByHostId ?? EMPTY_GROUPS,
  };
}
