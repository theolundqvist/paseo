import { useReplicaQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { buildTerminalsQueryKey } from "@/screens/workspace/terminals/state";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceDirectory } from "@/stores/session-store-hooks";
import { getFocusedTabInLayout } from "@/stores/workspace-layout-actions";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";

function useTerminalLaunchDirectory(input: {
  serverId: string;
  workspaceId: string;
  workspaceDirectory: string | null;
  terminalId: string | null;
  enabled: boolean;
}): string | null {
  const { serverId, workspaceId, workspaceDirectory, terminalId, enabled } = input;
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const query = useReplicaQuery({
    queryKey: buildTerminalsQueryKey(serverId, workspaceDirectory, workspaceId),
    enabled:
      enabled && Boolean(client && isConnected && workspaceDirectory && workspaceId && terminalId),
    pushEvent: "terminals_changed",
    queryFn: async () => {
      if (!client || !workspaceDirectory) {
        throw new Error("Workspace directory not found");
      }
      return client.listTerminals(workspaceDirectory, undefined, { workspaceId });
    },
    // cwd is immutable launch metadata, not the shell's current directory after cd.
    select: (payload) =>
      payload.terminals.find((terminal) => terminal.id === terminalId)?.cwd || null,
  });
  return query.data ?? null;
}

export function useFocusedWorkspaceDirectory(input: {
  serverId: string;
  workspaceId: string;
  enabled?: boolean;
}): string | null {
  const { serverId, workspaceId, enabled = true } = input;
  const workspaceDirectory = useWorkspaceDirectory(serverId, workspaceId);
  const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
  const target = useWorkspaceLayoutStore((state) => {
    const layout = workspaceKey ? state.layoutByWorkspace[workspaceKey] : null;
    return getFocusedTabInLayout(layout)?.target ?? null;
  });
  let agentId: string | null = null;
  if (target?.kind === "agent" || (target?.kind === "plugin" && target.context === "agent")) {
    agentId = target.agentId;
  } else if (target?.kind === "provider_subagent") {
    agentId = target.parentAgentId;
  }
  const agentDirectory = useSessionStore((state) => {
    if (!agentId) return null;
    const session = state.sessions[serverId];
    const agent = session?.agents.get(agentId) ?? session?.agentDetails.get(agentId);
    return agent?.cwd || null;
  });
  const terminalId = target?.kind === "terminal" ? target.terminalId : null;
  const terminalDirectory = useTerminalLaunchDirectory({
    serverId,
    workspaceId,
    workspaceDirectory,
    terminalId,
    enabled,
  });

  if (agentId) return agentDirectory;
  if (terminalId) return terminalDirectory;
  if (target?.kind === "draft" && target.setup) return target.setup.cwd || null;
  return workspaceDirectory;
}
