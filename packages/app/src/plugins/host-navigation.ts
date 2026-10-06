import type { PluginHostNavigation } from "@getpaseo/plugin/client";
import { useSessionStore } from "@/stores/session-store";
import { resolveWorkspaceMapKeyByIdentity } from "@/utils/workspace-identity";
import { useMemo } from "react";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { navigateToAgent } from "@/utils/navigate-to-agent";

import { getIsElectron } from "@/constants/platform";
import { createWorkspaceBrowser } from "@/desktop/browser/store";
import { createPluginHostNavigation } from "./host-navigation-model";

export function createAppPluginHostNavigation(serverId: string): PluginHostNavigation {
  return createPluginHostNavigation(serverId, {
    browserAvailable: getIsElectron(),
    openAgent: navigateToAgent,
    openWorkspace: navigateToWorkspace,
    createBrowser: createWorkspaceBrowser,
    resolveWorkspace: ({ serverId: targetServerId, workspaceId }) =>
      resolveWorkspaceMapKeyByIdentity({
        workspaces: useSessionStore.getState().sessions[targetServerId]?.workspaces,
        workspaceId,
      }),
  });
}

export function usePluginHostNavigation(serverId: string): PluginHostNavigation {
  return useMemo(() => createAppPluginHostNavigation(serverId), [serverId]);
}
