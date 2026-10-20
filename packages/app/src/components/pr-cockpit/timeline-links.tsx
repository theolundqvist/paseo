import { useMemo } from "react";
import type { StreamItem } from "@/types/stream";
import { CockpitLinkScanner, findCockpitLinks } from "./links";
import { PaneCockpitLinks } from "./pane-links";

function collectContentLinks(value: unknown, links: Set<string>): void {
  if (typeof value === "string") {
    for (const url of findCockpitLinks(value)) links.add(url);
  } else if (Array.isArray(value)) {
    for (const entry of value) collectContentLinks(entry, links);
  } else if (value !== null && typeof value === "object") {
    for (const entry of Object.values(value)) collectContentLinks(entry, links);
  }
}

function scanItemLinks(item: StreamItem): readonly string[] {
  const links = new Set<string>();
  switch (item.kind) {
    case "user_message":
    case "assistant_message":
    case "thought":
      collectContentLinks(item.text, links);
      break;
    case "tool_call":
      collectContentLinks(item.payload.data, links);
      break;
    case "notification":
      collectContentLinks(item.message, links);
      break;
    case "todo_list":
      collectContentLinks(item.items, links);
      break;
    case "plugin":
      collectContentLinks(item.data, links);
      break;
    case "compaction":
      break;
  }
  return [...links];
}

type StreamingItem = Extract<StreamItem, { kind: "assistant_message" | "thought" }>;

interface ActiveLinks {
  item: StreamingItem;
  scanner: CockpitLinkScanner;
  consumed: number;
}

export function createTimelineCockpitLinkSelector() {
  const cache = new WeakMap<StreamItem, readonly string[]>();
  const active = new Map<string, ActiveLinks>();
  let visibleLinks: readonly string[] = [];

  function scanStreamingItem(item: StreamingItem): readonly string[] {
    let current = active.get(item.id);
    const isReplacement =
      current &&
      current.item !== item &&
      (current.item.kind !== item.kind || !item.text.startsWith(current.item.text));
    if (!current || isReplacement) {
      current = { item, scanner: new CockpitLinkScanner(), consumed: 0 };
    }
    current.scanner.write(item.text.slice(current.consumed));
    current.consumed = item.text.length;
    current.item = item;
    active.set(item.id, current);
    return current.scanner.getLinks();
  }

  return (items: readonly StreamItem[]): readonly string[] => {
    // Source items have no assistant completion flag. Only the latest assistant
    // and thought can grow; keep those two scanners, not every historical text.
    let assistant: StreamingItem | undefined;
    let thought: StreamingItem | undefined;
    for (let index = items.length - 1; index >= 0; index--) {
      const item = items[index]!;
      if (!assistant && item.kind === "assistant_message") assistant = item;
      if (!thought && item.kind === "thought") thought = item;
      if (assistant && thought) break;
    }
    for (const id of active.keys()) {
      if (id !== assistant?.id && id !== thought?.id) active.delete(id);
    }
    const links = new Set<string>();
    for (const item of items) {
      let itemLinks = cache.get(item);
      const isActive = item === assistant || item === thought;
      if (isActive) {
        itemLinks = scanStreamingItem(item);
        cache.set(item, itemLinks);
      }
      if (!itemLinks) {
        itemLinks = scanItemLinks(item);
        cache.set(item, itemLinks);
      }
      for (const url of itemLinks) links.add(url);
    }
    if (visibleLinks.length !== links.size || visibleLinks.some((url) => !links.has(url))) {
      visibleLinks = [...links];
    }
    return visibleLinks;
  };
}

export function TimelineCockpitLinks({ items }: { items: readonly StreamItem[] }) {
  const selectLinks = useMemo(() => createTimelineCockpitLinkSelector(), []);
  const links = useMemo(() => selectLinks(items), [items, selectLinks]);
  return <PaneCockpitLinks links={links} />;
}
