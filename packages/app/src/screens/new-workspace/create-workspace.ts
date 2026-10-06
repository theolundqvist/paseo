import type { QueryClient } from "@tanstack/react-query";
import type {
  CreateWorkspaceRequestOptions,
  DaemonClient,
} from "@getpaseo/client/internal/daemon-client";
import type {
  AgentAttachment,
  AgentSnapshotPayload,
  CreationSnapshot,
} from "@getpaseo/protocol/messages";
import { ensureCheckoutStatus } from "@/git/checkout-status-cache";
import { getHostProjectId, type HostProjectListItem } from "@/projects/host-projects";
import { normalizeWorkspaceDescriptor, type WorkspaceDescriptor } from "@/stores/session-store";
import {
  defaultBasePickerItem,
  pickerItemToCheckoutRequest,
  type PickerCheckoutRequest,
  type PickerItem,
} from "../new-workspace-picker-item";

export interface WorkspaceCreationResult {
  workspace: WorkspaceDescriptor;
  agent?: AgentSnapshotPayload;
}

function buildFirstAgentContext(input: {
  prompt: string;
  attachments: AgentAttachment[];
}): { prompt?: string; attachments?: AgentAttachment[] } | undefined {
  const trimmedPrompt = input.prompt.trim();
  if (!trimmedPrompt && input.attachments.length === 0) {
    return undefined;
  }

  return {
    ...(trimmedPrompt ? { prompt: trimmedPrompt } : {}),
    attachments: input.attachments,
  };
}

/** Without an explicit base, a worktree branches from the source checkout's current branch. */
export async function resolveWorktreeCheckoutRequest(input: {
  queryClient: QueryClient;
  client: DaemonClient;
  serverId: string;
  sourceDirectory: string;
  selectedItem: PickerItem | null;
}): Promise<PickerCheckoutRequest | undefined> {
  const status = await ensureCheckoutStatus({
    queryClient: input.queryClient,
    client: input.client,
    serverId: input.serverId,
    cwd: input.sourceDirectory,
  });
  return pickerItemToCheckoutRequest(input.selectedItem ?? defaultBasePickerItem(status));
}

export async function createMultiplicityWorkspace(input: {
  idempotencyKey: string;
  worktreeSlug: string;
  client: DaemonClient;
  isolation: "local" | "worktree";
  project: HostProjectListItem;
  sourceDirectory: string;
  checkoutRequest: PickerCheckoutRequest | undefined;
  withInitialAgent: boolean;
  agent?: CreateWorkspaceRequestOptions["agent"];
  onEvent?: (snapshot: CreationSnapshot) => void;
  prompt: string;
  attachments: AgentAttachment[];
  mergeWorkspaces: (serverId: string, workspaces: WorkspaceDescriptor[]) => void;
  serverId: string;
  createFailedMessage: string;
}): Promise<WorkspaceCreationResult> {
  const projectId = getHostProjectId(input.project, input.serverId);
  if (!projectId) throw new Error("Project is not available on the selected host");
  const isWorktree = input.isolation === "worktree";
  const firstAgentContext = buildFirstAgentContext({
    prompt: input.prompt,
    attachments: input.attachments,
  });
  const payload = await input.client.createWorkspace({
    idempotencyKey: input.idempotencyKey,
    agent: input.agent,
    onEvent: input.onEvent,
    source: isWorktree
      ? {
          kind: "worktree",
          cwd: input.sourceDirectory,
          projectId,
          worktreeSlug: input.worktreeSlug,
          ...input.checkoutRequest,
        }
      : {
          kind: "directory",
          path: input.sourceDirectory,
          projectId,
        },
    ...(firstAgentContext ? { firstAgentContext } : {}),
  });
  if (payload.error || !payload.workspace) {
    throw new Error(payload.error ?? input.createFailedMessage);
  }
  const normalizedWorkspace = normalizeWorkspaceDescriptor(payload.workspace);
  const workspaceForInitialMerge = input.withInitialAgent
    ? { ...normalizedWorkspace, status: "running" as const, statusEnteredAt: new Date() }
    : normalizedWorkspace;
  input.mergeWorkspaces(input.serverId, [workspaceForInitialMerge]);
  return { workspace: normalizedWorkspace, agent: payload.agent };
}
