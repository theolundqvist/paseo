import type { PluginServerContext } from "@getpaseo/plugin/server";
import { listAnswers, markAnswersRead } from "./server/answers.js";
import { clearNeed, listNeeds } from "./server/needs.js";
import { answersListRpc, answersMarkReadRpc } from "./shared/answers.js";
import { needsClearRpc, needsListRpc } from "./shared/needs.js";

export default function contribute(server: PluginServerContext) {
  server.handle(needsListRpc, listNeeds);
  server.handle(needsClearRpc, clearNeed);
  server.handle(answersListRpc, listAnswers);
  server.handle(answersMarkReadRpc, markAnswersRead);
  server.on("agent.archived", async ({ agent }) => {
    await clearNeed({ agentId: agent.id });
  });
  return () => {};
}
