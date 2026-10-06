import type { PluginClientContext } from "@getpaseo/plugin/client";
import { createAttentionStore } from "./client/attention.js";
import { addCommands } from "./client/commands.js";
import { syncComposerPills } from "./client/pills.js";
import { createScreens } from "./client/screens.js";
import { createSidebarItems } from "./client/sidebar.js";

export default function contribute(client: PluginClientContext) {
  const store = createAttentionStore(client);
  const { NeedsScreen, AnswersScreen } = createScreens(client, store);
  const { NeedsItem, AnswersItem } = createSidebarItems(store);
  client.addScreen({ id: "needs", title: "Needs", Component: NeedsScreen });
  client.addScreen({ id: "answers", title: "Answers", Component: AnswersScreen });
  client.addSidebarHeaderItem({ id: "needs", title: "Needs", Component: NeedsItem });
  client.addSidebarHeaderItem({ id: "answers", title: "Answers", Component: AnswersItem });
  const removeCommands = addCommands(client, store);
  const removePills = syncComposerPills(client, store);
  return () => {
    removePills();
    removeCommands();
    store.dispose();
  };
}
