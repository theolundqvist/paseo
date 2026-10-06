import type { PluginClientStateSource } from "@getpaseo/plugin/client/host";
import type { CommandCenterContribution } from "@/command-center/contributions";
import { getCommandCenterIcon } from "@/command-center/icon";
import { resolvePluginIcon } from "../icons";
import type { InstalledPlugin } from "../types";
import {
  createPluginAgentActionContext,
  createPluginCapabilities,
  createPluginWorkspaceActionContext,
  type PluginNavigation,
} from "../actions";

export interface PluginCommandCenterSource {
  plugins: readonly InstalledPlugin[];
  state: PluginClientStateSource;
  workspaceId: string | null;
  agentId: string | null;
  navigation: PluginNavigation;
  reportError(error: unknown): void;
}

export function buildPluginCommandCenterContributions(
  source: PluginCommandCenterSource,
): CommandCenterContribution[] {
  const { state, navigation, workspaceId, agentId } = source;
  const contributions: CommandCenterContribution[] = [];
  for (const plugin of source.plugins) {
    for (const [rank, item] of plugin.commandCenterItems.entries()) {
      if (item.context === "workspace" && !workspaceId) continue;
      if (item.context === "agent" && (!workspaceId || !agentId)) continue;
      const run = async () => {
        try {
          if (item.context === "global") {
            const focusedAgent = agentId ? state.getAgent(agentId) : null;
            await item.onSelect({
              context: "global",
              ...createPluginCapabilities(plugin, navigation),
              navigation: navigation.host,
              ...(focusedAgent
                ? { focusedAgent: { id: focusedAgent.id, workspaceId: focusedAgent.workspaceId } }
                : {}),
            });
            return;
          }
          if (!workspaceId) return;
          if (item.context === "workspace") {
            const context = createPluginWorkspaceActionContext({
              plugin,
              navigation,
              state,
              workspaceId,
            });
            if (context) await item.onSelect(context);
            return;
          }
          if (!agentId) return;
          const context = createPluginAgentActionContext({
            plugin,
            navigation,
            state,
            workspaceId,
            agentId,
          });
          if (context) await item.onSelect(context);
        } catch (error) {
          source.reportError(error);
        }
      };
      contributions.push({
        id: `${plugin.id}:${item.id}`,
        group: `plugin:${plugin.id}`,
        groupRank: 5,
        rank,
        keywords: item.keywords ?? [],
        visibility: "always",
        presentation: {
          kind: "action",
          title: item.title,
          sectionTitle: plugin.id,
          icon: getCommandCenterIcon(resolvePluginIcon(item.icon)),
        },
        run,
      });
    }
  }
  return contributions;
}
