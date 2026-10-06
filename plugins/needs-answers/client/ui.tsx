import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo } from "react";
import { Pressable, StyleSheet, Text } from "react-native";

export const layoutStyles = StyleSheet.create({
  stack: { gap: 12 },
  list: { gap: 8 },
  row: { flexDirection: "row", gap: 8, alignItems: "center" },
  scroll: { maxHeight: 320 },
});

export function useTextStyles(theme: PluginTheme) {
  return useMemo(
    () =>
      StyleSheet.create({
        body: { color: theme.colors.foreground, fontSize: 14 },
        bodyFill: { color: theme.colors.foreground, fontSize: 14, flex: 1 },
        strong: { color: theme.colors.foreground, fontSize: 14, fontWeight: "600" },
        muted: { color: theme.colors.foregroundMuted, fontSize: 13 },
        mutedFill: { color: theme.colors.foregroundMuted, fontSize: 13, flex: 1 },
        error: { color: theme.colors.statusDanger, fontSize: 13 },
      }),
    [theme],
  );
}

export function ActionButton({
  theme,
  label,
  onPress,
  busy = false,
  primary = false,
}: {
  theme: PluginTheme;
  label: string;
  onPress(): void;
  busy?: boolean;
  primary?: boolean;
}) {
  const styles = useMemo(
    () =>
      StyleSheet.create({
        button: {
          paddingHorizontal: 12,
          paddingVertical: 6,
          borderRadius: 6,
          alignSelf: "flex-start",
          backgroundColor: primary ? theme.colors.accent : theme.colors.surface2,
          opacity: busy ? 0.6 : 1,
        },
        label: {
          color: primary ? theme.colors.accentForeground : theme.colors.foreground,
          fontSize: 13,
          fontWeight: "600",
        },
      }),
    [theme, primary, busy],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={busy}
      onPress={onPress}
      style={styles.button}
    >
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

export function ErrorText({ theme, error }: { theme: PluginTheme; error: unknown }) {
  const styles = useTextStyles(theme);
  return <Text style={styles.error}>{error instanceof Error ? error.message : String(error)}</Text>;
}

export function formatAge(updatedAt: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(updatedAt)) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
