import { useMemo } from "react";
import { useSessionStore } from "@/stores/session-store";
import type { StreamItem } from "@/types/stream";
import { extractPullRequestKeys } from "./pull-request-keys";

const MAX_LINKED_PULL_REQUESTS = 100;
const NO_KEYS: readonly string[] = [];
const NO_ITEMS: readonly StreamItem[] = [];

// Stream reducers replace items instead of mutating them, so each message text is scanned once.
const keysByItem = new WeakMap<StreamItem, readonly string[]>();

function messageKeys(item: StreamItem): readonly string[] {
  if (item.kind !== "user_message" && item.kind !== "assistant_message") {
    return NO_KEYS;
  }
  let keys = keysByItem.get(item);
  if (keys === undefined) {
    keys = extractPullRequestKeys(item.text);
    keysByItem.set(item, keys);
  }
  return keys;
}

export function collectLinkedPullRequestKeys(input: {
  tail: readonly StreamItem[];
  head: readonly StreamItem[];
}): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const newestFirst = [...input.tail, ...input.head].toReversed();
  for (const item of newestFirst) {
    for (const key of messageKeys(item)) {
      if (seen.has(key.toLowerCase())) {
        continue;
      }
      seen.add(key.toLowerCase());
      keys.push(key);
      if (keys.length === MAX_LINKED_PULL_REQUESTS) {
        return keys;
      }
    }
  }
  return keys;
}

/** Pull requests the agent's loaded chat links to, the most recently mentioned first. */
export function useLinkedPullRequestKeys(input: {
  serverId: string;
  agentId: string | null;
}): readonly string[] {
  const { serverId, agentId } = input;
  const tail = useSessionStore((state) =>
    agentId ? state.sessions[serverId]?.agentStreamTail.get(agentId) : undefined,
  );
  const head = useSessionStore((state) =>
    agentId ? state.sessions[serverId]?.agentStreamHead.get(agentId) : undefined,
  );
  return useMemo(
    () => collectLinkedPullRequestKeys({ tail: tail ?? NO_ITEMS, head: head ?? NO_ITEMS }),
    [tail, head],
  );
}
