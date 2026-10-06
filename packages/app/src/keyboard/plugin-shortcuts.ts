import { create } from "zustand";

/** A plugin Command Center item's shortcut, before overrides and collision resolution. */
export interface PluginShortcut {
  /** `plugin:<pluginId>:<itemId>`, also the override-store key. */
  bindingId: string;
  title: string;
  combo: string;
}

interface PluginShortcutsState {
  shortcuts: readonly PluginShortcut[];
  /** Runners for items available in the current context, keyed by binding id. */
  runners: ReadonlyMap<string, () => void>;
}

const EMPTY_RUNNERS: ReadonlyMap<string, () => void> = new Map();

export const usePluginShortcutsStore = create<PluginShortcutsState>(() => ({
  shortcuts: [],
  runners: EMPTY_RUNNERS,
}));

export function runPluginShortcut(bindingId: string): boolean {
  const run = usePluginShortcutsStore.getState().runners.get(bindingId);
  if (!run) return false;
  run();
  return true;
}
