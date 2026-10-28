import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";

export interface ChatScrollState {
  isAwayFromLatest: boolean;
  revision: number;
}

const AT_LATEST: ChatScrollState = { isAwayFromLatest: false, revision: 0 };

interface ChatScrollStoreState {
  bySession: ReadonlyMap<string, ChatScrollState>;
  report: (sessionKey: string, isAwayFromLatest: boolean) => void;
  remove: (sessionKey: string) => void;
}

type ChatScrollStore = StoreApi<ChatScrollStoreState>;

export function createChatScrollStore(): ChatScrollStore {
  return createStore<ChatScrollStoreState>((set) => ({
    bySession: new Map(),
    report: (sessionKey, isAwayFromLatest) =>
      set((state) => {
        const previous = state.bySession.get(sessionKey) ?? AT_LATEST;
        if (previous.isAwayFromLatest === isAwayFromLatest) return state;
        const bySession = new Map(state.bySession);
        bySession.set(sessionKey, { isAwayFromLatest, revision: previous.revision + 1 });
        return { bySession };
      }),
    remove: (sessionKey) =>
      set((state) => {
        if (!state.bySession.has(sessionKey)) return state;
        const bySession = new Map(state.bySession);
        bySession.delete(sessionKey);
        return { bySession };
      }),
  }));
}

const ChatScrollContext = createContext<ChatScrollStore | null>(null);
const emptyStore = createChatScrollStore();

export function PrCockpitScrollProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createChatScrollStore);
  return <ChatScrollContext.Provider value={store}>{children}</ChatScrollContext.Provider>;
}

// Only the existing chat viewport reports this signal. No wheel listener, geometry
// measurement, or scrolling is owned by the overlay.
export function useReportPrCockpitChatScroll(input: {
  serverId: string;
  agentId: string;
  isAwayFromLatest: boolean;
}) {
  const store = useContext(ChatScrollContext);
  const sessionKey = `${input.serverId}:${input.agentId}`;
  useEffect(() => () => store?.getState().remove(sessionKey), [store, sessionKey]);
  useEffect(() => {
    store?.getState().report(sessionKey, input.isAwayFromLatest);
  }, [store, sessionKey, input.isAwayFromLatest]);
}

export function usePrCockpitChatScroll(serverId: string, agentId: string | null): ChatScrollState {
  const store = useContext(ChatScrollContext) ?? emptyStore;
  return useStore(store, (state) => state.bySession.get(`${serverId}:${agentId}`) ?? AT_LATEST);
}
