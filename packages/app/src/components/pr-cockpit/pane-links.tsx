import { useCallback, useId, useState, type MouseEvent } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";
import { usePaneFocus } from "@/panels/pane-context";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import { openExternalUrl } from "@/utils/open-external-url";
import { ScrollView } from "@/components/ui/scroll-view";

interface CockpitLinkProps {
  url: string;
  onOpen: (url: string) => void;
}

function CockpitLink({ url, onOpen }: CockpitLinkProps) {
  const [, , , owner, repo, number] = url.split("/");
  const label = `Open ${owner}/${repo} PR ${number} in PR Cockpit`;
  const handlePress = useCallback(() => onOpen(url), [onOpen, url]);
  const handleClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      event.stopPropagation();
      onOpen(url);
    },
    [onOpen, url],
  );
  const handleAuxClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      if (event.button === 1) onOpen(url);
    },
    [onOpen, url],
  );
  const content = (
    <Text numberOfLines={1} style={styles.label}>
      {repo} #{number}
    </Text>
  );

  return isWeb ? (
    <a
      href={url}
      aria-label={label}
      title={label}
      style={ANCHOR_STYLE}
      onClick={handleClick}
      onAuxClick={handleAuxClick}
    >
      {content}
    </a>
  ) : (
    <Pressable accessibilityRole="link" accessibilityLabel={label} onPress={handlePress}>
      {content}
    </Pressable>
  );
}

export function PaneCockpitLinks({ links }: { links: readonly string[] }) {
  const handlerId = useId();
  const { isInteractive } = usePaneFocus();
  const isActive = useRetainedPanelActive();
  const [error, setError] = useState<string | null>(null);
  const open = useCallback((url: string) => {
    setError(null);
    void openExternalUrl(url).catch(() => {
      setError("Could not open PR Cockpit. Check that the app is installed.");
    });
  }, []);

  useKeyboardActionHandler({
    handlerId: `pr-cockpit:${handlerId}`,
    actions: ["workspace.pr-cockpit.open"],
    enabled: isInteractive && isActive,
    priority: 100,
    handle: () => {
      const first = links[0];
      if (!first) return false;
      open(first);
      return true;
    },
  });

  if (links.length === 0) return null;
  return (
    <View style={styles.container} testID="pane-pr-cockpit-links">
      <ScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator
        style={styles.scroll}
        contentContainerStyle={styles.links}
      >
        {links.map((url) => (
          <CockpitLink key={url} url={url} onOpen={open} />
        ))}
      </ScrollView>
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const ANCHOR_STYLE = { textDecoration: "none", flexShrink: 0, whiteSpace: "nowrap" } as const;
const styles = StyleSheet.create((theme) => ({
  container: {
    flexShrink: 0,
    backgroundColor: theme.colors.surface0,
  },
  scroll: {
    flexGrow: 0,
  },
  links: {
    flexGrow: 1,
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textDecorationLine: "underline",
  },
  error: {
    paddingHorizontal: theme.spacing[2],
    paddingBottom: theme.spacing[1],
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
