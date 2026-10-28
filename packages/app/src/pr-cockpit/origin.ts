import { getIsElectron } from "@/constants/platform";
import { invokeDesktopCommand } from "@/desktop/electron/invoke";
import { DEFAULT_PR_COCKPIT_ORIGIN } from "./embed";

export function resolvePrCockpitOrigin(): Promise<string> {
  return getIsElectron()
    ? invokeDesktopCommand<string>("desktop_pr_cockpit_origin")
    : Promise.resolve(DEFAULT_PR_COCKPIT_ORIGIN);
}
