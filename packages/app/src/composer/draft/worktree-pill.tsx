import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { withUnistyles } from "react-native-unistyles";
import { GitBranch } from "lucide-react-native";
import { composerPillStyles } from "@/composer/pill-styles";
import type { Theme } from "@/styles/theme";

const ThemedGitBranch = withUnistyles(GitBranch);
const iconColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/** Marks a draft whose first submit creates a new worktree workspace. */
export function ComposerWorktreePill() {
  const { t } = useTranslation();
  return (
    <View style={composerPillStyles.body} testID="composer-worktree-pill">
      <ThemedGitBranch size={14} uniProps={iconColorMapping} />
      <Text style={composerPillStyles.label} numberOfLines={1}>
        {t("newWorkspace.isolation.worktree")}
      </Text>
    </View>
  );
}
