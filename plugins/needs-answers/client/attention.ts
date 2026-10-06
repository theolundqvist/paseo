import type { PluginClientContext } from "@getpaseo/plugin/client";
import { useSyncExternalStore } from "react";
import { type AnswersForCwd, answersListRpc } from "../shared/answers.js";
import { type Need, needsListRpc } from "../shared/needs.js";

const POLL_MS = 2_000;

export interface AttentionAgent {
  id: string;
  workspaceId: string;
  cwd: string;
  title: string | null;
  /** Workspace name, else project name, else the cwd's last segment. */
  workspace: string;
}

export interface AttentionSnapshot {
  agents: ReadonlyMap<string, AttentionAgent>;
  /** Open needs of this host's agents, oldest first. */
  needs: readonly Need[];
  /** One entry per distinct agent cwd. */
  answers: readonly AnswersForCwd[];
}

export interface AttentionStore {
  getSnapshot(): AttentionSnapshot;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<void>;
  dispose(): void;
}

interface DirectoryAgent {
  id: string;
  workspaceId?: string;
  cwd: string;
  title: string | null;
  archivedAt?: string | null;
}

interface DirectoryPlacement {
  projectName: string;
  workspaceName?: string | null;
}

export function createAttentionStore(client: PluginClientContext): AttentionStore {
  const lifetime = new AbortController();
  const listeners = new Set<() => void>();
  const agents = new Map<string, AttentionAgent>();
  let fetched: { needs: readonly Need[]; answers: readonly AnswersForCwd[] } = {
    needs: [],
    answers: [],
  };
  let fetchedJson = "";
  let snapshot: AttentionSnapshot = { agents: new Map(), needs: [], answers: [] };
  let inflight: Promise<void> | null = null;
  let failing = false;

  const publish = () => {
    const known = new Map(agents);
    snapshot = {
      agents: known,
      needs: fetched.needs.filter((need) => known.has(need.agentId)),
      answers: fetched.answers,
    };
    for (const listener of listeners) listener();
  };

  const load = async () => {
    const cwds = [...new Set([...agents.values()].map((agent) => agent.cwd))];
    try {
      const [needs, answers] = await Promise.all([
        client.rpc(needsListRpc, {}),
        client.rpc(answersListRpc, { cwds }),
      ]);
      failing = false;
      const next = { needs: needs.needs, answers: answers.cwds };
      const nextJson = JSON.stringify(next);
      if (nextJson === fetchedJson) return;
      fetched = next;
      fetchedJson = nextJson;
      publish();
    } catch (error) {
      if (!failing && !lifetime.signal.aborted)
        console.error("Needs and answers refresh failed", error);
      failing = true;
    }
  };

  const refresh = () => {
    inflight ??= load().finally(() => {
      inflight = null;
    });
    return inflight;
  };

  const track = (agent: DirectoryAgent, project: DirectoryPlacement | null | undefined) => {
    if (agent.archivedAt || !agent.workspaceId) {
      agents.delete(agent.id);
      return;
    }
    agents.set(agent.id, {
      id: agent.id,
      workspaceId: agent.workspaceId,
      cwd: agent.cwd,
      title: agent.title,
      workspace:
        project?.workspaceName ??
        project?.projectName ??
        agent.cwd.split("/").findLast((part) => part.length > 0) ??
        agent.cwd,
    });
  };

  const directoryChanged = () => {
    publish();
    void refresh();
  };

  void client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      subscription.subscribe({
        snapshot: ({ entries }) => {
          agents.clear();
          for (const { agent, project } of entries) track(agent, project);
          directoryChanged();
        },
        update: (message) => {
          if (message.type !== "agent_update") return;
          const update = message.payload;
          if (update.kind === "remove") agents.delete(update.agentId);
          else track(update.agent, update.project);
          directoryChanged();
        },
      });
      return undefined;
    })
    .catch((error) => {
      if (!lifetime.signal.aborted) console.error("Agent observation failed", error);
    });

  const timer = setInterval(() => void refresh(), POLL_MS);

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh,
    dispose() {
      clearInterval(timer);
      lifetime.abort();
      listeners.clear();
    },
  };
}

export function useAttention(store: AttentionStore): AttentionSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/** Unread rows per canonical cwd key, counted once however many agents share it. */
export function unreadByKey(snapshot: AttentionSnapshot): ReadonlyMap<string, AnswersForCwd> {
  const byKey = new Map<string, AnswersForCwd>();
  for (const entry of snapshot.answers) {
    if (entry.unread.length > 0 && !byKey.has(entry.key)) byKey.set(entry.key, entry);
  }
  return byKey;
}
