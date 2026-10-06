import { useMutation } from "@tanstack/react-query";
import type {
  PluginButtonContentProps,
  PluginButtonIconProps,
  PluginButtonRegistration,
  PluginClientContext,
} from "@getpaseo/plugin/client";
import { Icon, ScrollView } from "@getpaseo/plugin/client/react-native";
import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { answersMarkReadRpc } from "../shared/answers.js";
import { needsClearRpc } from "../shared/needs.js";
import { type AttentionStore, useAttention } from "./attention.js";
import { ActionButton, ErrorText, layoutStyles, useTextStyles } from "./ui.js";

const LABEL_LIMIT = 40;

function NeedIcon({ size, theme }: PluginButtonIconProps) {
  return <Icon name="CircleAlert" size={size} color={theme.colors.statusDanger} />;
}

function needLabel(text: string): string {
  if (text.length <= LABEL_LIMIT) return text;
  return `${text.slice(0, LABEL_LIMIT - 1).trimEnd()}…`;
}

interface Pill {
  registration: PluginButtonRegistration;
  label: string;
}

interface AgentPills {
  workspaceId: string;
  need: Pill | null;
  answers: Pill | null;
}

export function syncComposerPills(client: PluginClientContext, store: AttentionStore): () => void {
  const pills = new Map<string, AgentPills>();

  function NeedPopover(props: PluginButtonContentProps) {
    const { theme, close } = props;
    const agentId = props.context === "agent" ? props.agentId : null;
    const { needs } = useAttention(store);
    const need = needs.find((candidate) => candidate.agentId === agentId);
    const clear = useMutation({
      mutationFn: async (target: string) => {
        await client.rpc(needsClearRpc, { agentId: target });
        await store.refresh();
      },
      onSuccess: close,
    });
    const onClear = useCallback(() => {
      if (agentId) clear.mutate(agentId);
    }, [agentId, clear]);
    const text = useTextStyles(theme);
    return (
      <View style={layoutStyles.stack}>
        <Text style={text.body}>{need?.text}</Text>
        {clear.error ? <ErrorText theme={theme} error={clear.error} /> : null}
        <ActionButton
          theme={theme}
          label="Clear"
          primary
          busy={clear.isPending}
          onPress={onClear}
        />
      </View>
    );
  }

  function AnswersPopover(props: PluginButtonContentProps) {
    const { theme, close } = props;
    const agentId = props.context === "agent" ? props.agentId : null;
    const snapshot = useAttention(store);
    const cwd = agentId ? snapshot.agents.get(agentId)?.cwd : undefined;
    const entry = snapshot.answers.find((candidate) => candidate.cwd === cwd);
    const rows = useMemo(() => (entry?.unread ?? []).toReversed(), [entry]);
    const markRead = useMutation({
      mutationFn: async (target: string) => {
        await client.rpc(answersMarkReadRpc, { cwd: target });
        await store.refresh();
      },
      onSuccess: close,
    });
    const onMarkRead = useCallback(() => {
      if (cwd) markRead.mutate(cwd);
    }, [cwd, markRead]);
    const text = useTextStyles(theme);
    return (
      <View style={layoutStyles.stack}>
        <ScrollView style={layoutStyles.scroll} contentContainerStyle={layoutStyles.list}>
          {rows.map((row) => (
            <View key={row.order} style={layoutStyles.row}>
              <Text style={text.muted}>{row.time}</Text>
              <Text style={text.bodyFill}>{row.text}</Text>
            </View>
          ))}
        </ScrollView>
        {markRead.error ? <ErrorText theme={theme} error={markRead.error} /> : null}
        <ActionButton
          theme={theme}
          label="Mark read"
          primary
          busy={markRead.isPending}
          onPress={onMarkRead}
        />
      </View>
    );
  }

  const place = (input: {
    current: Pill | null;
    label: string | null;
    create(label: string): PluginButtonRegistration;
  }): Pill | null => {
    const { current, label } = input;
    if (label === null) {
      current?.registration.remove();
      return null;
    }
    if (!current) return { label, registration: input.create(label) };
    if (current.label !== label) current.registration.update({ label });
    return { registration: current.registration, label };
  };

  const sync = () => {
    const snapshot = store.getSnapshot();
    const needByAgent = new Map(snapshot.needs.map((need) => [need.agentId, need.text]));
    const unreadByCwd = new Map(snapshot.answers.map((entry) => [entry.cwd, entry.unread.length]));

    for (const [agentId, state] of pills) {
      if (snapshot.agents.get(agentId)?.workspaceId === state.workspaceId) continue;
      state.need?.registration.remove();
      state.answers?.registration.remove();
      pills.delete(agentId);
    }

    for (const agent of snapshot.agents.values()) {
      const state = pills.get(agent.id) ?? {
        workspaceId: agent.workspaceId,
        need: null,
        answers: null,
      };
      pills.set(agent.id, state);
      const target = { workspaceId: agent.workspaceId, agentId: agent.id };
      const need = needByAgent.get(agent.id);
      state.need = place({
        current: state.need,
        label: need === undefined ? null : needLabel(need),
        create: (label) =>
          client.addComposerPill({
            ...target,
            id: "need",
            button: {
              title: "Need",
              icon: NeedIcon,
              label,
              behavior: { kind: "popover", Content: NeedPopover },
            },
          }),
      });
      const unread = unreadByCwd.get(agent.cwd) ?? 0;
      state.answers = place({
        current: state.answers,
        label: unread > 0 ? `${unread} new` : null,
        create: (label) =>
          client.addComposerPill({
            ...target,
            id: "answers",
            button: {
              title: "Answers",
              icon: "Mail",
              label,
              behavior: { kind: "popover", Content: AnswersPopover },
            },
          }),
      });
    }
  };

  const unsubscribe = store.subscribe(sync);
  sync();
  return () => {
    unsubscribe();
    for (const state of pills.values()) {
      state.need?.registration.remove();
      state.answers?.registration.remove();
    }
    pills.clear();
  };
}
