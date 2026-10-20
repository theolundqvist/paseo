import { useMemo } from "react";
import type { StreamItem } from "@/types/stream";
import { findCockpitLinks } from "./links";
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

export function createTimelineCockpitLinkSelector() {
  const cache = new WeakMap<StreamItem, readonly string[]>();
  return (items: readonly StreamItem[]): readonly string[] => {
    const links = new Set<string>();
    for (const item of items) {
      let itemLinks = cache.get(item);
      if (!itemLinks) {
        const found = new Set<string>();
        switch (item.kind) {
          case "user_message":
          case "assistant_message":
          case "thought":
            collectContentLinks(item.text, found);
            break;
          case "tool_call":
            collectContentLinks(item.payload.data, found);
            break;
          case "notification":
            collectContentLinks(item.message, found);
            break;
          case "todo_list":
            collectContentLinks(item.items, found);
            break;
          case "plugin":
            collectContentLinks(item.data, found);
            break;
          case "compaction":
            break;
        }
        itemLinks = [...found];
        cache.set(item, itemLinks);
      }
      for (const url of itemLinks) links.add(url);
    }
    return [...links];
  };
}

export function TimelineCockpitLinks({ items }: { items: readonly StreamItem[] }) {
  const selectLinks = useMemo(() => createTimelineCockpitLinkSelector(), []);
  const links = useMemo(() => selectLinks(items), [items, selectLinks]);
  return <PaneCockpitLinks links={links} />;
}
