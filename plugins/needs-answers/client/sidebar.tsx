import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { useCallback, useMemo } from "react";
import { type AttentionStore, unreadByKey, useAttention } from "./attention.js";

export function createSidebarItems(store: AttentionStore) {
  function NeedsItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
    const { needs } = useAttention(store);
    const onPress = useCallback(() => openScreen({ screenId: "needs" }), [openScreen]);
    if (needs.length === 0) return null;
    return (
      <SidebarRow
        icon="CircleAlert"
        label={`Needs (${needs.length})`}
        active={currentScreen?.screenId === "needs"}
        onPress={onPress}
      />
    );
  }

  function AnswersItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
    const snapshot = useAttention(store);
    const unread = useMemo(
      () =>
        [...unreadByKey(snapshot).values()].reduce((sum, entry) => sum + entry.unread.length, 0),
      [snapshot],
    );
    const onPress = useCallback(() => openScreen({ screenId: "answers" }), [openScreen]);
    if (unread === 0) return null;
    return (
      <SidebarRow
        icon="Mail"
        label={`Answers (${unread} unread)`}
        active={currentScreen?.screenId === "answers"}
        onPress={onPress}
      />
    );
  }

  return { NeedsItem, AnswersItem };
}
