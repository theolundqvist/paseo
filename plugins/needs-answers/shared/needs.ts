import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const NeedSchema = z.object({
  agentId: z.string(),
  text: z.string(),
  cwd: z.string(),
  updatedAt: z.string(),
});

export type Need = z.infer<typeof NeedSchema>;

export const AgentIdSchema = z.string().regex(/^[A-Za-z0-9_-]+$/);

export const needsListRpc = defineRpc({
  name: "needs.list",
  input: z.object({}),
  output: z.object({ needs: z.array(NeedSchema) }),
});

export const needsClearRpc = defineRpc({
  name: "needs.clear",
  input: z.object({ agentId: AgentIdSchema }),
  output: z.object({}),
});
