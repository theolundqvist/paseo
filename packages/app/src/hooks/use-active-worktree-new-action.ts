import { useCallback } from "react";
import { router } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/contexts/toast-context";
import { type CheckoutStatusPayload, useCheckoutStatusQuery } from "@/git/use-status-query";
import { useFocusedWorkspaceDirectory } from "@/hooks/use-focused-workspace-directory";
import { useOpenProject } from "@/hooks/use-open-project";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import type { KeyboardActionId } from "@/keyboard/keyboard-action-dispatcher";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { useWorkspace } from "@/stores/session-store-hooks";
import { buildNewWorkspaceRoute } from "@/utils/host-routes";

const WORKTREE_NEW_ACTIONS: readonly KeyboardActionId[] = ["worktree.new"];

function projectIdForCheckout(
  workspace: WorkspaceDescriptor | null,
  checkout: CheckoutStatusPayload | null,
): string | null {
  if (workspace?.projectKind !== "git" || !checkout?.isGit) return null;
  if (
    checkout.repoRoot === workspace.workspaceDirectory ||
    checkout.repoRoot === workspace.projectRootPath ||
    checkout.mainRepoRoot === workspace.projectRootPath
  ) {
    return workspace.projectId;
  }
  return null;
}

export function useActiveWorktreeNewAction() {
  const selection = useActiveWorkspaceSelection();
  const serverId = selection?.serverId ?? "";
  const workspaceId = selection?.workspaceId ?? "";
  const activeWorkspace = useWorkspace(serverId, workspaceId);
  const cwd = useFocusedWorkspaceDirectory({
    serverId,
    workspaceId,
  });
  const { status } = useCheckoutStatusQuery({ serverId, cwd: cwd ?? "" });
  const isConnected = useHostRuntimeIsConnected(serverId);
  const canAddProject = useHostFeature(serverId, "projectAdd");
  const hasStableProjectIdentity = useHostFeature(serverId, "stableProjectIdentity");
  const openProject = useOpenProject(serverId);
  const toast = useToast();
  const gitStatus = status?.isGit && !status.error ? status : null;
  const knownProjectId = projectIdForCheckout(activeWorkspace, gitStatus);
  const canOpen = Boolean(
    serverId &&
    cwd &&
    gitStatus &&
    isConnected &&
    (knownProjectId || (canAddProject && hasStableProjectIdentity)),
  );
  const openMutation = useMutation({
    mutationFn: async () => {
      if (!serverId || !cwd || !gitStatus) return;
      let projectId = knownProjectId;
      if (!projectId) {
        const result = await openProject(gitStatus.repoRoot);
        if (!result.ok) {
          throw new Error(result.error ?? "Unable to open project");
        }
        if (result.project.projectKind !== "git") {
          throw new Error("The focused directory is no longer a Git checkout");
        }
        projectId = result.project.projectId;
      }
      router.navigate(
        buildNewWorkspaceRoute({ serverId, sourceDirectory: cwd, projectId }) as never,
      );
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const handle = useCallback(() => {
    if (!canOpen) return false;
    if (!openMutation.isPending) openMutation.mutate();
    return true;
  }, [canOpen, openMutation]);

  useKeyboardActionHandler({
    handlerId: "worktree-new-active",
    actions: WORKTREE_NEW_ACTIONS,
    enabled: canOpen,
    priority: 0,
    handle,
  });
}
