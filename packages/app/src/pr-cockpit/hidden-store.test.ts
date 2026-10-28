import { describe, expect, it, vi } from "vitest";
import type { StateStorage } from "zustand/middleware";
import {
  createPrCockpitHiddenStore,
  EMPTY_HIDDEN_KEYS,
  filterHiddenPullRequestKeys,
  prCockpitSessionKey,
  type PrCockpitHiddenStore,
} from "./hidden-store";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  },
}));

function memoryStorage(entries = new Map<string, string>()): StateStorage {
  return {
    getItem: (name) => entries.get(name) ?? null,
    setItem: (name, value) => {
      entries.set(name, value);
    },
    removeItem: (name) => {
      entries.delete(name);
    },
  };
}

async function hydrated(store: PrCockpitHiddenStore) {
  if (store.persist.hasHydrated()) return;
  await new Promise<void>((resolve) => {
    const unsubscribe = store.persist.onFinishHydration(() => {
      unsubscribe();
      resolve();
    });
  });
}

function visible(
  store: PrCockpitHiddenStore,
  serverId: string,
  agentId: string,
  keys = ["Acme/API#12"],
) {
  const sessionKey = prCockpitSessionKey({ serverId, agentId });
  const hidden = store.getState().hiddenBySession[sessionKey] ?? EMPTY_HIDDEN_KEYS;
  return filterHiddenPullRequestKeys(keys, hidden);
}

describe("PR Cockpit local hides", () => {
  it("hides synchronously, deduplicates case variants, and isolates both server and agent", async () => {
    const store = createPrCockpitHiddenStore(memoryStorage());
    await hydrated(store);
    store.getState().hide({ serverId: "server-a", agentId: "agent-a", key: "Acme/API#12" });
    store.getState().hide({ serverId: "server-a", agentId: "agent-a", key: "acme/api#12" });

    expect(visible(store, "server-a", "agent-a")).toEqual([]);
    expect(visible(store, "server-a", "agent-b")).toEqual(["Acme/API#12"]);
    expect(visible(store, "server-b", "agent-a")).toEqual(["Acme/API#12"]);
    expect(Object.values(store.getState().hiddenBySession)).toEqual([["acme/api#12"]]);
    // A different session being selected does not reconcile away the original session's hides.
    expect(visible(store, "server-a", "agent-a", ["acme/api#13", "acme/api#12"])).toEqual([
      "acme/api#13",
    ]);
  });

  it("does not alias session identifiers containing delimiters", async () => {
    const store = createPrCockpitHiddenStore(memoryStorage());
    await hydrated(store);
    store.getState().hide({ serverId: "server:a", agentId: "b", key: "acme/api#12" });
    expect(visible(store, "server", "a:b")).toEqual(["Acme/API#12"]);
    expect(visible(store, "server:a", "b")).toEqual([]);
  });

  it("rehydrates hidden keys on reload and persists undo without affecting another scope", async () => {
    const storage = memoryStorage();
    const original = createPrCockpitHiddenStore(storage);
    await hydrated(original);
    const request = {
      serverId: "server-a",
      agentId: "agent-a",
      key: "acme/api#12",
    };
    original.getState().hide(request);
    original.getState().hide({ ...request, agentId: "agent-b" });

    const reloaded = createPrCockpitHiddenStore(storage);
    await hydrated(reloaded);
    expect(visible(reloaded, "server-a", "agent-a")).toEqual([]);
    expect(visible(reloaded, "server-a", "agent-b")).toEqual([]);
    reloaded.getState().restore(request);
    expect(visible(reloaded, "server-a", "agent-a")).toEqual(["Acme/API#12"]);
    expect(visible(reloaded, "server-a", "agent-b")).toEqual([]);

    const afterUndo = createPrCockpitHiddenStore(storage);
    await hydrated(afterUndo);
    expect(visible(afterUndo, "server-a", "agent-a")).toEqual(["Acme/API#12"]);
    expect(visible(afterUndo, "server-a", "agent-b")).toEqual([]);
  });

  it.each([
    "not json",
    JSON.stringify({
      state: { hiddenBySession: { session: ["not-a-pr"] } },
      version: 1,
    }),
    JSON.stringify({
      state: { hiddenBySession: { session: ["acme/api#12"] }, hide: "code" },
      version: 1,
    }),
  ])("rejects corrupt persisted state: %s", async (raw) => {
    const entries = new Map([["pr-cockpit-hidden", raw]]);
    const store = createPrCockpitHiddenStore(memoryStorage(entries));
    await hydrated(store);
    expect(store.getState().hiddenBySession).toEqual({});
    expect(entries.has("pr-cockpit-hidden")).toBe(false);
  });
});
