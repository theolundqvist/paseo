import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { persist, type StateStorage } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import { isPullRequestKey } from "./pull-request-keys";

interface PullRequestScope {
  serverId: string;
  agentId: string;
}

interface ScopedPullRequest extends PullRequestScope {
  key: string;
}

const PersistedHiddenStateSchema = z.strictObject({
  hiddenBySession: z.record(z.string(), z.array(z.string().refine(isPullRequestKey))),
});

type PersistedHiddenState = z.infer<typeof PersistedHiddenStateSchema>;

interface HiddenStoreState extends PersistedHiddenState {
  hide: (pullRequest: ScopedPullRequest) => void;
  restore: (pullRequest: ScopedPullRequest) => void;
}

export const EMPTY_HIDDEN_KEYS: readonly string[] = [];

export function prCockpitSessionKey({ serverId, agentId }: PullRequestScope): string {
  return JSON.stringify([serverId, agentId]);
}

export function filterHiddenPullRequestKeys(
  keys: readonly string[],
  hiddenKeys: readonly string[],
): string[] {
  return keys.filter((key) => !hiddenKeys.includes(key.toLowerCase()));
}

export function createPrCockpitHiddenStore(backingStorage: StateStorage = AsyncStorage) {
  return create<HiddenStoreState>()(
    persist(
      (set) => ({
        hiddenBySession: {},
        hide: (pullRequest) =>
          set((state) => {
            const sessionKey = prCockpitSessionKey(pullRequest);
            const key = pullRequest.key.toLowerCase();
            const hidden = state.hiddenBySession[sessionKey] ?? EMPTY_HIDDEN_KEYS;
            if (hidden.includes(key)) return state;
            return {
              hiddenBySession: {
                ...state.hiddenBySession,
                [sessionKey]: [...hidden, key],
              },
            };
          }),
        restore: (pullRequest) =>
          set((state) => {
            const sessionKey = prCockpitSessionKey(pullRequest);
            const key = pullRequest.key.toLowerCase();
            const hidden = state.hiddenBySession[sessionKey] ?? EMPTY_HIDDEN_KEYS;
            if (!hidden.includes(key)) return state;
            const hiddenBySession = { ...state.hiddenBySession };
            const remaining = hidden.filter((entry) => entry !== key);
            if (remaining.length === 0) {
              delete hiddenBySession[sessionKey];
            } else {
              hiddenBySession[sessionKey] = remaining;
            }
            return { hiddenBySession };
          }),
      }),
      {
        name: "pr-cockpit-hidden",
        version: 1,
        storage: createValidatedPersistStorage(backingStorage, PersistedHiddenStateSchema),
        partialize: (state) => ({ hiddenBySession: state.hiddenBySession }),
      },
    ),
  );
}

export const usePrCockpitHiddenStore = createPrCockpitHiddenStore();
export type PrCockpitHiddenStore = typeof usePrCockpitHiddenStore;

export function usePrCockpitHiddenStoreHydrated(): boolean {
  const [hydrated, setHydrated] = useState(() => usePrCockpitHiddenStore.persist.hasHydrated());
  useEffect(() => {
    if (usePrCockpitHiddenStore.persist.hasHydrated()) {
      setHydrated(true);
      return;
    }
    return usePrCockpitHiddenStore.persist.onFinishHydration(() => setHydrated(true));
  }, []);
  return hydrated;
}
