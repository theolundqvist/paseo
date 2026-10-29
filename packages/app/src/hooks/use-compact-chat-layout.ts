import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import { useSettings } from "@/hooks/use-settings";

/**
 * Terminal-dense agent chat: full pane width, tight spacing, slim composer. Opt-in through the
 * `compactChatLayout` setting and only on wide web/desktop layouts; phones and native keep the
 * regular chat layout whatever the setting says.
 */
export function useCompactChatLayout(): boolean {
  const enabled = useSettings((settings) => settings.compactChatLayout);
  const isCompactFormFactor = useIsCompactFormFactor();
  return enabled && !isNative && !isCompactFormFactor;
}
