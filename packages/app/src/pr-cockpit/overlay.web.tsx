import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useFetchQuery } from "@/data/query";
import { Text, View, type LayoutChangeEvent } from "react-native";
import { ChevronDown, ChevronUp, GitPullRequest } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { Button } from "@/components/ui/button";
import { useToast } from "@/contexts/toast-context";
import type { Theme } from "@/styles/theme";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { openExternalUrl } from "@/utils/open-external-url";
import { buildPrCockpitEmbedUrl, readPrCockpitFrameMessage } from "./embed";
import type { PrCockpitOverlayProps } from "./overlay";
import { useLinkedPullRequestKeys } from "./use-linked-pull-request-keys";
import { usePrCockpitChatScroll, type ChatScrollState } from "./chat-scroll-state";
import {
  INITIAL_COLLAPSE_STATE,
  isPrCockpitCollapsed,
  togglePrCockpitCollapsed,
} from "./collapse-state";
import { resolvePrCockpitOrigin } from "./origin";
import {
  EMPTY_HIDDEN_KEYS,
  filterHiddenPullRequestKeys,
  prCockpitSessionKey,
  usePrCockpitHiddenStore,
  usePrCockpitHiddenStoreHydrated,
} from "./hidden-store";

const OVERLAY_WIDTH = 340;
const OVERLAY_INSET = 8;
const MAX_HEIGHT_RATIO = 0.45;
// A link streams in over several chunks; waiting for the key set to hold still keeps a
// half-streamed PR number from flashing the wrong row.
const KEYS_SETTLE_MS = 400;
// The frame is a trusted local app, but it must not navigate Paseo or open windows itself;
// opening a PR goes through the validated `open` message.
const FRAME_SANDBOX = "allow-scripts allow-same-origin";

const ThemedGitPullRequest = withUnistyles(GitPullRequest);
const ThemedChevronUp = withUnistyles(ChevronUp);
const ThemedChevronDown = withUnistyles(ChevronDown);
const mutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

interface PaneSize {
  width: number;
  height: number;
}

interface SettledKeys {
  sessionKey: string;
  signature: string;
}

export function PrCockpitOverlay({ serverId, agentId, isPointerSuspended }: PrCockpitOverlayProps) {
  const keys = useLinkedPullRequestKeys({ serverId, agentId });
  const scroll = usePrCockpitChatScroll(serverId, agentId);
  const signature = keys.join(",");
  const sessionKey = prCockpitSessionKey({ serverId, agentId });
  const hiddenKeys = usePrCockpitHiddenStore(
    (state) => state.hiddenBySession[sessionKey] ?? EMPTY_HIDDEN_KEYS,
  );
  const hiddenStoreHydrated = usePrCockpitHiddenStoreHydrated();
  const hide = usePrCockpitHiddenStore((state) => state.hide);
  const toast = useToast();
  const hidePullRequest = useCallback(
    (key: string) => {
      const currentHidden = usePrCockpitHiddenStore.getState().hiddenBySession[sessionKey];
      if (currentHidden?.includes(key.toLowerCase())) return;
      hide({ serverId, agentId, key });
      toast.show(
        <HiddenPullRequestNotice serverId={serverId} agentId={agentId} pullRequestKey={key} />,
        { durationMs: 6000 },
      );
    },
    [serverId, agentId, sessionKey, hide, toast],
  );
  const { data: origin } = useFetchQuery({
    queryKey: ["prCockpitOrigin"],
    queryFn: resolvePrCockpitOrigin,
    dataShape: "value",
    staleTimeMs: 60_000,
    enabled: signature !== "",
    retry: false,
  });
  const [settled, setSettled] = useState<SettledKeys>({ sessionKey, signature });
  useEffect(() => {
    const timer = setTimeout(() => setSettled({ sessionKey, signature }), KEYS_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [sessionKey, signature]);

  // Only transcript discovery is debounced. Local hides must remove an advertised row now,
  // including when the transcript is still streaming or this session is revisited.
  const settledSignature = settled.sessionKey === sessionKey ? settled.signature : signature;
  const visibleSignature = filterHiddenPullRequestKeys(
    settledSignature.split(","),
    hiddenKeys,
  ).join(",");
  if (!hiddenStoreHydrated || signature === "" || visibleSignature === "" || !origin) {
    return null;
  }
  return (
    <PrCockpitEmbed
      key={sessionKey}
      origin={origin}
      signature={visibleSignature}
      scroll={scroll}
      isPointerSuspended={isPointerSuspended}
      onHide={hidePullRequest}
    />
  );
}

function HiddenPullRequestNotice({
  serverId,
  agentId,
  pullRequestKey,
}: {
  serverId: string;
  agentId: string;
  pullRequestKey: string;
}) {
  const restore = usePrCockpitHiddenStore((state) => state.restore);
  const toast = useToast();
  const { t } = useTranslation();
  const undo = useCallback(() => {
    restore({ serverId, agentId, key: pullRequestKey });
    toast.show(t("workspace.linkedPullRequests.restored", { key: pullRequestKey }));
  }, [serverId, agentId, pullRequestKey, restore, toast, t]);

  return (
    <View style={styles.hiddenFeedback}>
      <Text style={styles.feedbackText}>
        {t("workspace.linkedPullRequests.hidden", { key: pullRequestKey })}
      </Text>
      <Button variant="ghost" size="sm" onPress={undo}>
        {t("workspace.linkedPullRequests.undo")}
      </Button>
    </View>
  );
}

function PrCockpitEmbed({
  origin,
  signature,
  isPointerSuspended,
  scroll,
  onHide,
}: {
  origin: string;
  signature: string;
  isPointerSuspended: boolean;
  scroll: ChatScrollState;
  onHide: (key: string) => void;
}) {
  const { t } = useTranslation();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const keyCount = signature.split(",").length;
  const embedUrl = useMemo(
    () => buildPrCockpitEmbedUrl(origin, signature.split(",")),
    [origin, signature],
  );
  const [initialEmbedUrl] = useState(embedUrl);
  const appliedEmbedUrlRef = useRef(embedUrl);
  const advertisedKeysRef = useRef(signature.split(","));
  const [contentHeight, setContentHeight] = useState(0);
  const [paneSize, setPaneSize] = useState<PaneSize | null>(null);
  const [collapseState, toggleCollapsedState] = useReducer(
    togglePrCockpitCollapsed,
    INITIAL_COLLAPSE_STATE,
  );
  const isCollapsed = isPrCockpitCollapsed(collapseState, scroll);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (isCollapsed && iframe && document.activeElement === iframe) {
      iframe.blur();
    }
  }, [isCollapsed]);

  // Replacing the location keeps the change a same-document hash navigation: the embed keeps
  // its live connection and the app's back history gains no iframe entries.
  useEffect(() => {
    const frameWindow = iframeRef.current?.contentWindow;
    if (!frameWindow || appliedEmbedUrlRef.current === embedUrl) {
      return;
    }
    appliedEmbedUrlRef.current = embedUrl;
    frameWindow.location.replace(embedUrl);
    advertisedKeysRef.current = signature.split(",");
  }, [embedUrl, signature]);

  useEffect(() => {
    function receiveMessage(event: MessageEvent) {
      const iframe = iframeRef.current;
      const message = readPrCockpitFrameMessage(event, {
        origin,
        frameWindow: iframe?.contentWindow ?? null,
        advertisedKeys: advertisedKeysRef.current,
      });
      if (message === null) {
        return;
      }
      if (message.type === "size") {
        setContentHeight(Math.ceil(message.height));
        return;
      }
      if (message.type === "hide") {
        onHide(message.key);
        return;
      }
      // Clicking a row moves keyboard focus into the frame; hand it back so app shortcuts
      // keep working once the PR opens.
      if (iframe && document.activeElement === iframe) {
        iframe.blur();
      }
      void openExternalUrl(message.url);
    }
    window.addEventListener("message", receiveMessage);
    return () => window.removeEventListener("message", receiveMessage);
  }, [origin, onHide]);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width <= 0 || height <= 0) {
      return;
    }
    setPaneSize((current) =>
      current?.width === width && current.height === height ? current : { width, height },
    );
  }, []);
  const toggleCollapsed = useCallback(() => toggleCollapsedState(scroll), [scroll]);

  const isReady = contentHeight > 0 && paneSize !== null;
  const isFrameVisible = isReady && !isCollapsed;
  const frameWidth = paneSize
    ? Math.max(0, Math.min(OVERLAY_WIDTH, paneSize.width - OVERLAY_INSET * 2))
    : OVERLAY_WIDTH;
  const maxFrameHeight = paneSize ? Math.floor(paneSize.height * MAX_HEIGHT_RATIO) : 0;
  const frameHeight = isFrameVisible ? Math.min(contentHeight, maxFrameHeight) : 0;
  // Collapsed, the frame leaves the flow so the card shrinks to the header pill while the
  // embed keeps its width and keeps reporting its size.
  const frameStyle = useMemo<CSSProperties>(
    () => ({
      display: "block",
      position: isCollapsed ? "absolute" : "static",
      top: 0,
      right: 0,
      width: frameWidth,
      height: frameHeight,
      border: 0,
      background: "transparent",
      pointerEvents: isPointerSuspended ? "none" : "auto",
    }),
    [frameHeight, frameWidth, isCollapsed, isPointerSuspended],
  );
  const isInteractive = isReady && !isPointerSuspended;

  return (
    <View style={styles.layer} pointerEvents="box-none" onLayout={handleLayout}>
      <View
        pointerEvents={isInteractive ? "auto" : "none"}
        style={[styles.card, isReady ? styles.cardSurface : null]}
        testID="pr-cockpit-overlay"
      >
        {isReady ? (
          <View
            style={[
              styles.header,
              isCollapsed ? null : inlineUnistylesStyle({ width: frameWidth }),
            ]}
          >
            <View style={styles.summary}>
              <ThemedGitPullRequest size={14} uniProps={mutedColorMapping} />
              <Text style={styles.count}>{keyCount}</Text>
            </View>
            <ToolbarButton
              label={t(
                isCollapsed
                  ? "workspace.linkedPullRequests.expand"
                  : "workspace.linkedPullRequests.collapse",
              )}
              onPress={toggleCollapsed}
              testID="pr-cockpit-overlay-toggle"
            >
              {isCollapsed ? (
                <ThemedChevronDown size={14} uniProps={mutedColorMapping} />
              ) : (
                <ThemedChevronUp size={14} uniProps={mutedColorMapping} />
              )}
            </ToolbarButton>
          </View>
        ) : null}
        <iframe
          ref={iframeRef}
          title={t("workspace.linkedPullRequests.title")}
          src={initialEmbedUrl}
          sandbox={FRAME_SANDBOX}
          tabIndex={isFrameVisible ? 0 : -1}
          style={frameStyle}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  hiddenFeedback: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  feedbackText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  layer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 30,
  },
  card: {
    position: "absolute",
    top: OVERLAY_INSET,
    right: OVERLAY_INSET,
    overflow: "hidden",
  },
  cardSurface: {
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.popover,
    ...theme.shadow.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[0.5],
    paddingVertical: theme.spacing[0.5],
  },
  summary: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  count: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    fontVariant: ["tabular-nums"],
  },
}));
