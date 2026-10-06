import { readdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { Need, needsClearRpc, needsListRpc } from "../shared/needs.js";

const NeedFileSchema = z.object({ text: z.string(), cwd: z.string(), updatedAt: z.string() });

export function needsDir(): string {
  return path.join(homedir(), ".config", ".needs");
}

export function needFile(agentId: string): string {
  return path.join(needsDir(), `${agentId}.json`);
}

async function readNeed(file: string): Promise<Need | null> {
  try {
    const parsed = NeedFileSchema.safeParse(JSON.parse(await readFile(file, "utf8")));
    if (!parsed.success) return null;
    return { agentId: path.basename(file, ".json"), ...parsed.data };
  } catch {
    return null;
  }
}

// Deleting an agent fires no hook, so needs of agents that no longer exist are dropped here.
export async function listNeeds(
  _input: RpcInput<typeof needsListRpc>,
  { paseo }: PluginHandlerContext,
): Promise<RpcOutput<typeof needsListRpc>> {
  let names: string[];
  try {
    names = await readdir(needsDir());
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return { needs: [] };
    throw error;
  }
  const files = names.filter((name) => name.endsWith(".json") && !name.startsWith("."));
  const needs = await Promise.all(
    files.map(async (name) => {
      const need = await readNeed(path.join(needsDir(), name));
      if (!need) return null;
      if ((await paseo.agents.ref(need.agentId).refresh()) !== null) return need;
      await rm(needFile(need.agentId), { force: true });
      return null;
    }),
  );
  return {
    needs: needs
      .filter((need): need is Need => need !== null)
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt)),
  };
}

export async function clearNeed({
  agentId,
}: RpcInput<typeof needsClearRpc>): Promise<RpcOutput<typeof needsClearRpc>> {
  await rm(needFile(agentId), { force: true });
  return {};
}
