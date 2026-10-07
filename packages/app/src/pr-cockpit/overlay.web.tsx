import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Text, View, type LayoutChangeEvent } from "react-native";
import { ChevronDown, ChevronUp, GitPullRequest } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import type { Theme } from "@/styles/theme";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { openExternalUrl } from "@/utils/open-external-url";
import { PR_COCKPIT_ORIGIN, buildPrCockpitEmbedUrl, parsePrCockpitEmbedMessage } from "./embed";
import type { PrCockpitOverlayProps } from "./overlay";
import { useLinkedPullRequestKeys } from "./use-linked-pull-request-keys";

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
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

interface PaneSize {
  width: number;
  height: number;
}

interface SettledKeys {
  agentId: string | null;
  signature: string;
}

export function PrCockpitOverlay({ serverId, agentId, isPointerSuspended }: PrCockpitOverlayProps) {
  const keys = useLinkedPullRequestKeys({ serverId, agentId });
  const signature = keys.join(",");
  const [settled, setSettled] = useState<SettledKeys>({ agentId, signature });
  useEffect(() => {
    const timer = setTimeout(() => setSettled({ agentId, signature }), KEYS_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [agentId, signature]);

  const visibleSignature = settled.agentId === agentId ? settled.signature : signature;
  if (signature === "" || visibleSignature === "") {
    return null;
  }
  return <PrCockpitEmbed signature={visibleSignature} isPointerSuspended={isPointerSuspended} />;
}

function PrCockpitEmbed({
  signature,
  isPointerSuspended,
}: {
  signature: string;
  isPointerSuspended: boolean;
}) {
  const { t } = useTranslation();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const keyCount = signature.split(",").length;
  const embedUrl = useMemo(() => buildPrCockpitEmbedUrl(signature.split(",")), [signature]);
  const [initialEmbedUrl] = useState(embedUrl);
  const appliedEmbedUrlRef = useRef(embedUrl);
  const [contentHeight, setContentHeight] = useState(0);
  const [paneSize, setPaneSize] = useState<PaneSize | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Replacing the location keeps the change a same-document hash navigation: the embed keeps
  // its live connection and the app's back history gains no iframe entries.
  useEffect(() => {
    const frameWindow = iframeRef.current?.contentWindow;
    if (!frameWindow || appliedEmbedUrlRef.current === embedUrl) {
      return;
    }
    appliedEmbedUrlRef.current = embedUrl;
    frameWindow.location.replace(embedUrl);
  }, [embedUrl]);

  useEffect(() => {
    function receiveMessage(event: MessageEvent) {
      const iframe = iframeRef.current;
      const isFromFrame =
        event.origin === PR_COCKPIT_ORIGIN &&
        iframe !== null &&
        event.source === iframe.contentWindow;
      if (!isFromFrame) {
        return;
      }
      const message = parsePrCockpitEmbedMessage(event.data);
      if (message === null) {
        return;
      }
      if (message.type === "size") {
        setContentHeight(Math.ceil(message.height));
        return;
      }
      // Clicking a row moves keyboard focus into the frame; hand it back so app shortcuts
      // keep working once the PR opens.
      if (document.activeElement === iframe) {
        iframe.blur();
      }
      void openExternalUrl(message.url);
    }
    window.addEventListener("message", receiveMessage);
    return () => window.removeEventListener("message", receiveMessage);
  }, []);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width <= 0 || height <= 0) {
      return;
    }
    setPaneSize((current) =>
      current?.width === width && current.height === height ? current : { width, height },
    );
  }, []);
  const toggleCollapsed = useCallback(() => setIsCollapsed((current) => !current), []);

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
