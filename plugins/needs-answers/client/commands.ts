import type { PluginClientContext } from "@getpaseo/plugin/client";
import { answersMarkReadRpc } from "../shared/answers.js";
import { needsClearRpc } from "../shared/needs.js";
import type { AttentionStore } from "./attention.js";

export function addCommands(client: PluginClientContext, store: AttentionStore): () => void {
  const removers = [
    client.addCommandCenterItem({
      id: "needs-next",
      title: "Go to next need",
      icon: "CircleAlert",
      keywords: ["needs", "attention"],
      context: "global",
      shortcut: "Mod+Y",
      async onSelect({ navigation, focusedAgent }) {
        await store.refresh();
        const { needs } = store.getSnapshot();
        const focused = needs.findIndex((need) => need.agentId === focusedAgent?.id);
        const next = needs[(focused + 1) % needs.length];
        if (!next || next.agentId === focusedAgent?.id) return;
        navigation.openAgent({ agentId: next.agentId });
      },
    }),
    client.addCommandCenterItem({
      id: "needs-clear",
      title: "Clear need",
      icon: "CircleCheck",
      keywords: ["needs"],
      context: "agent",
      shortcut: "Mod+Shift+Y",
      async onSelect({ agent, rpc }) {
        await rpc(needsClearRpc, { agentId: agent.id });
        await store.refresh();
      },
    }),
    client.addCommandCenterItem({
      id: "answers-open",
      title: "Open answers",
      icon: "Mail",
      context: "global",
      shortcut: "Mod+Shift+U",
      onSelect({ openScreen }) {
        openScreen({ screenId: "answers" });
      },
    }),
    client.addCommandCenterItem({
      id: "answers-mark-read",
      title: "Mark answers read",
      icon: "MailCheck",
      keywords: ["answers"],
      context: "agent",
      shortcut: "Mod+Alt+U",
      async onSelect({ agent, rpc }) {
        await rpc(answersMarkReadRpc, { cwd: agent.cwd });
        await store.refresh();
      },
    }),
  ];
  return () => {
    for (const remove of removers) remove();
  };
}
