import { useMutation } from "@tanstack/react-query";
import type { PluginClientContext, PluginScreenProps } from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { type AnswerRow, answersMarkReadRpc } from "../shared/answers.js";
import { type Need, needsClearRpc } from "../shared/needs.js";
import {
  type AttentionAgent,
  type AttentionSnapshot,
  type AttentionStore,
  unreadByKey,
  useAttention,
} from "./attention.js";
import { ActionButton, ErrorText, formatAge, layoutStyles, useTextStyles } from "./ui.js";

const AGE_TICK_MS = 30_000;

function useScreenStyles(theme: PluginTheme, compact: boolean) {
  return useMemo(
    () =>
      StyleSheet.create({
        screen: { flex: 1, backgroundColor: theme.colors.surface0 },
        content: { padding: compact ? 16 : 24, gap: 12 },
        card: {
          gap: 8,
          padding: 12,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface1,
        },
      }),
    [theme, compact],
  );
}

function cwdName(cwd: string): string {
  return cwd.split("/").findLast((part) => part.length > 0) ?? cwd;
}

function labelForKey(snapshot: AttentionSnapshot, key: string): string {
  const cwds = new Set(
    snapshot.answers.filter((entry) => entry.key === key).map((entry) => entry.cwd),
  );
  const titled = [...snapshot.agents.values()].find((agent) => cwds.has(agent.cwd) && agent.title);
  return titled?.title ?? cwdName(key);
}

export function createScreens(client: PluginClientContext, store: AttentionStore) {
  function NeedRow({
    need,
    agent,
    now,
    theme,
    openAgent,
  }: {
    need: Need;
    agent: AttentionAgent | undefined;
    now: number;
    theme: PluginTheme;
    openAgent: ((input: { agentId: string }) => void) | undefined;
  }) {
    const clear = useMutation({
      mutationFn: async () => {
        await client.rpc(needsClearRpc, { agentId: need.agentId });
        await store.refresh();
      },
    });
    const onClear = useCallback(() => clear.mutate(), [clear]);
    const onOpen = useCallback(() => openAgent?.({ agentId: need.agentId }), [openAgent, need]);
    const text = useTextStyles(theme);
    const styles = useScreenStyles(theme, false);
    return (
      <View style={styles.card}>
        <View style={layoutStyles.row}>
          <Text style={text.strong}>{agent?.title ?? need.agentId.slice(0, 8)}</Text>
          <Text style={text.muted}>{agent?.workspace ?? cwdName(need.cwd)}</Text>
          <Text style={text.muted}>{formatAge(need.updatedAt, now)}</Text>
        </View>
        <Text style={text.body}>{need.text}</Text>
        {clear.error ? <ErrorText theme={theme} error={clear.error} /> : null}
        <View style={layoutStyles.row}>
          {openAgent ? <ActionButton theme={theme} label="Open" primary onPress={onOpen} /> : null}
          <ActionButton theme={theme} label="Clear" busy={clear.isPending} onPress={onClear} />
        </View>
      </View>
    );
  }

  function NeedsScreen({ theme, layout, navigation }: PluginScreenProps) {
    const snapshot = useAttention(store);
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
      const timer = setInterval(() => setNow(Date.now()), AGE_TICK_MS);
      return () => clearInterval(timer);
    }, []);
    const styles = useScreenStyles(theme, layout.compact);
    const text = useTextStyles(theme);
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        {snapshot.needs.length === 0 ? <Text style={text.muted}>No open needs</Text> : null}
        {snapshot.needs.map((need) => (
          <NeedRow
            key={need.agentId}
            need={need}
            agent={snapshot.agents.get(need.agentId)}
            now={now}
            theme={theme}
            openAgent={navigation?.openAgent}
          />
        ))}
      </ScrollView>
    );
  }

  function MarkReadRow({
    cwd,
    label,
    count,
    theme,
  }: {
    cwd: string;
    label: string;
    count: number;
    theme: PluginTheme;
  }) {
    const markRead = useMutation({
      mutationFn: async () => {
        await client.rpc(answersMarkReadRpc, { cwd });
        await store.refresh();
      },
    });
    const onMarkRead = useCallback(() => markRead.mutate(), [markRead]);
    const text = useTextStyles(theme);
    return (
      <View style={layoutStyles.list}>
        <View style={layoutStyles.row}>
          <Text style={text.strong}>{label}</Text>
          <Text style={text.muted}>{`${count} new`}</Text>
          <ActionButton
            theme={theme}
            label="Mark read"
            busy={markRead.isPending}
            onPress={onMarkRead}
          />
        </View>
        {markRead.error ? <ErrorText theme={theme} error={markRead.error} /> : null}
      </View>
    );
  }

  function AnswerLine({
    row,
    label,
    unread,
    theme,
  }: {
    row: AnswerRow;
    label: string;
    unread: boolean;
    theme: PluginTheme;
  }) {
    const text = useTextStyles(theme);
    return (
      <View style={layoutStyles.row}>
        <Text style={text.muted}>{row.time}</Text>
        <Text style={unread ? text.strong : text.muted}>{label}</Text>
        <Text style={unread ? text.bodyFill : text.mutedFill}>{row.text}</Text>
      </View>
    );
  }

  function AnswersScreen({ theme, layout }: PluginScreenProps) {
    const snapshot = useAttention(store);
    const unread = useMemo(() => unreadByKey(snapshot), [snapshot]);
    const rows = useMemo(() => {
      const seen = new Set<string>();
      const lines: { key: string; row: AnswerRow; unread: boolean; label: string }[] = [];
      for (const entry of snapshot.answers) {
        if (seen.has(entry.key)) continue;
        seen.add(entry.key);
        const label = labelForKey(snapshot, entry.key);
        const unreadOrders = new Set(entry.unread.map((row) => row.order));
        for (const row of entry.recent) {
          lines.push({ key: entry.key, row, label, unread: unreadOrders.has(row.order) });
        }
      }
      return lines.sort((left, right) => right.row.order - left.row.order);
    }, [snapshot]);
    const styles = useScreenStyles(theme, layout.compact);
    const text = useTextStyles(theme);
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        {[...unread.values()].map((entry) => (
          <MarkReadRow
            key={entry.key}
            cwd={entry.cwd}
            label={labelForKey(snapshot, entry.key)}
            count={entry.unread.length}
            theme={theme}
          />
        ))}
        {rows.length === 0 ? <Text style={text.muted}>No answers</Text> : null}
        {rows.map((line) => (
          <AnswerLine
            key={`${line.key}:${line.row.order}`}
            row={line.row}
            label={line.label}
            unread={line.unread}
            theme={theme}
          />
        ))}
      </ScrollView>
    );
  }

  return { NeedsScreen, AnswersScreen };
}
