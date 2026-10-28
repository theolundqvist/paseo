import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// PR Cockpit's launcher sources shell config, not dotenv: preserve quoted values,
// exports, assignments, and its env > config > default precedence without a second parser.
const READ_COCKPIT_PORT = `
set -euo pipefail
env_port="\${COCKPIT_PORT:-}"
if [[ "$(uname -s)" == "Linux" ]]; then
  config_file="\${XDG_CONFIG_HOME:-$HOME/.config}/pr-cockpit/config"
else
  config_file="$HOME/.config/pr-cockpit/config"
fi
if [[ -f "$config_file" ]]; then
  source "$config_file" >&2
fi
printf '%s' "\${env_port:-\${COCKPIT_PORT:-4820}}"
`;

export async function resolvePrCockpitOrigin(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<string> {
  const portText =
    platform === "win32"
      ? env.COCKPIT_PORT || "4820"
      : (await execFileAsync("bash", ["-c", READ_COCKPIT_PORT], { env, timeout: 5000 })).stdout;
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PR Cockpit's COCKPIT_PORT must be a port between 1 and 65535.");
  }
  return `http://127.0.0.1:${port}`;
}
