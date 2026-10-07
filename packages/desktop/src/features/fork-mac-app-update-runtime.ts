import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, openSync, readFileSync } from "node:fs";
import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import { promisify } from "node:util";
import { app, autoUpdater as electronAutoUpdater } from "electron";
import type {
  AppUpdateInstallRequest,
  AppUpdateRuntime,
  AppUpdateRuntimeConfiguration,
  RuntimeUpdateCheckResult,
  RuntimeUpdateInfo,
} from "./app-update-service.js";

const execFileAsync = promisify(execFile);

const PREVIOUS_BUNDLE = "previous.app";

export interface ForkRelease {
  repository: string;
  tag: string;
}

export interface GitHubReleaseAsset {
  name: string;
  digest: string | null;
  browser_download_url: string;
}

export interface GitHubRelease {
  tag_name: string;
  draft: boolean;
  published_at: string | null;
  body: string | null;
  assets: GitHubReleaseAsset[];
}

interface ForkUpdate {
  info: RuntimeUpdateInfo;
  asset: GitHubReleaseAsset;
}

interface PreparedUpdate {
  tag: string;
  bundlePath: string;
}

// Written by the fork release workflow; absent from upstream and local builds.
export function readForkRelease(): ForkRelease | null {
  const stamp = path.join(app.getAppPath(), "dist", "fork-release.json");
  if (!existsSync(stamp)) return null;
  return JSON.parse(readFileSync(stamp, "utf8")) as ForkRelease;
}

// The releases API lists by creation order, which diverges from publish order
// whenever an older commit's build finishes later.
export function selectLatestForkUpdate(releases: GitHubRelease[], arch: string): ForkUpdate | null {
  let latest: (ForkUpdate & { publishedAt: string }) | null = null;
  for (const release of releases) {
    if (release.draft || !release.published_at || !release.tag_name.startsWith("fork-")) continue;
    const asset = release.assets.find((candidate) => candidate.name.endsWith(`-${arch}.zip`));
    if (!asset) continue;
    if (latest && latest.publishedAt >= release.published_at) continue;
    latest = {
      publishedAt: release.published_at,
      asset,
      info: {
        version: release.tag_name,
        releaseNotes: release.body ?? undefined,
        releaseDate: release.published_at,
      },
    };
  }
  return latest && { info: latest.info, asset: latest.asset };
}

async function downloadVerified(asset: GitHubReleaseAsset, destination: string): Promise<void> {
  const response = await fetch(asset.browser_download_url);
  if (!response.ok || !response.body) {
    throw new Error(`Update download failed: HTTP ${response.status}`);
  }
  const hash = createHash("sha256");
  await pipeline(
    Readable.fromWeb(response.body as ReadableStream<Uint8Array>),
    new Transform({
      transform(chunk, _encoding, callback) {
        hash.update(chunk);
        callback(null, chunk);
      },
    }),
    createWriteStream(destination),
  );
  const digest = `sha256:${hash.digest("hex")}`;
  if (digest !== asset.digest) {
    throw new Error(`Update checksum ${digest} does not match release digest ${asset.digest}`);
  }
}

// macOS's Squirrel updater only accepts a replacement signed by the same identity,
// which unsigned fork builds cannot satisfy, so the fork swaps the bundle itself.
export class ForkMacAppUpdateRuntime implements AppUpdateRuntime {
  private configuration: AppUpdateRuntimeConfiguration | null = null;
  private latest: ForkUpdate | null = null;
  private releases: GitHubRelease[] = [];
  private releasesEtag: string | null = null;
  private download: { tag: string; promise: Promise<void> } | null = null;
  private prepared: PreparedUpdate | null = null;
  private readonly updatesDir = path.join(app.getPath("userData"), "fork-updates");

  constructor(private readonly release: ForkRelease) {}

  configure(input: AppUpdateRuntimeConfiguration): void {
    this.configuration = input;
  }

  async checkForUpdates(): Promise<RuntimeUpdateCheckResult | null> {
    const latest = selectLatestForkUpdate(await this.fetchReleases(), process.arch);
    if (!latest) return null;
    if (latest.info.version === this.release.tag) {
      return { isUpdateAvailable: false, updateInfo: latest.info };
    }
    this.latest = latest;
    this.configuration?.onUpdateAvailable(latest.info);
    this.downloadUpdate(latest.info.version).catch((error) => this.configuration?.onError(error));
    return { isUpdateAvailable: true, updateInfo: latest.info };
  }

  downloadUpdate(targetVersion: string): Promise<void> {
    if (this.download?.tag === targetVersion) return this.download.promise;
    const update = this.latest;
    if (update?.info.version !== targetVersion) {
      return Promise.reject(new Error(`Update ${targetVersion} is no longer the latest release`));
    }
    const promise = this.prepare(update).then((prepared) => {
      this.prepared = prepared;
      this.configuration?.onUpdateDownloaded(update.info);
      return undefined;
    });
    this.download = { tag: targetVersion, promise };
    promise.catch(() => {
      if (this.download?.promise === promise) this.download = null;
    });
    return promise;
  }

  quitAndInstall({ targetVersion, isForceRunAfter }: AppUpdateInstallRequest): void {
    const prepared = this.prepared;
    if (prepared?.tag !== targetVersion) {
      throw new Error(`Update ${targetVersion} has not been downloaded`);
    }
    const log = openSync(path.join(this.updatesDir, "install.log"), "a");
    const installer = spawn(
      "/bin/sh",
      [
        "-c",
        [
          'while kill -0 "$PASEO_PID" 2>/dev/null; do sleep 0.2; done',
          'rm -rf "$PASEO_PREVIOUS"',
          'mv "$PASEO_TARGET" "$PASEO_PREVIOUS" || exit 1',
          'if ! mv "$PASEO_NEW" "$PASEO_TARGET"; then mv "$PASEO_PREVIOUS" "$PASEO_TARGET"; exit 1; fi',
          'if [ "$PASEO_RELAUNCH" = 1 ]; then open "$PASEO_TARGET"; fi',
        ].join("\n"),
      ],
      {
        detached: true,
        stdio: ["ignore", log, log],
        env: {
          PATH: "/usr/bin:/bin",
          PASEO_PID: String(process.pid),
          PASEO_TARGET: path.resolve(app.getPath("exe"), "../../.."),
          PASEO_NEW: prepared.bundlePath,
          PASEO_PREVIOUS: path.join(this.updatesDir, PREVIOUS_BUNDLE),
          PASEO_RELAUNCH: isForceRunAfter ? "1" : "0",
        },
      },
    );
    installer.unref();
    electronAutoUpdater.emit("before-quit-for-update");
    app.quit();
  }

  private async fetchReleases(): Promise<GitHubRelease[]> {
    const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
    if (this.releasesEtag) headers["If-None-Match"] = this.releasesEtag;
    const response = await fetch(
      `https://api.github.com/repos/${this.release.repository}/releases?per_page=20`,
      { headers },
    );
    if (response.status === 304) return this.releases;
    if (!response.ok) {
      throw new Error(`Release check failed: HTTP ${response.status}`);
    }
    this.releases = (await response.json()) as GitHubRelease[];
    this.releasesEtag = response.headers.get("etag");
    return this.releases;
  }

  // The previous bundle stays until the next update because a daemon kept running
  // after quit still loads files from it.
  private async prepare(update: ForkUpdate): Promise<PreparedUpdate> {
    const tag = update.info.version;
    await mkdir(this.updatesDir, { recursive: true });
    for (const entry of await readdir(this.updatesDir)) {
      if (entry !== PREVIOUS_BUNDLE && entry !== "install.log") {
        await rm(path.join(this.updatesDir, entry), { recursive: true, force: true });
      }
    }
    const dir = path.join(this.updatesDir, tag);
    await mkdir(dir);
    const zipPath = path.join(dir, update.asset.name);
    await downloadVerified(update.asset, zipPath);
    await execFileAsync("/usr/bin/ditto", ["-x", "-k", zipPath, dir]);
    await rm(zipPath);
    const bundle = (await readdir(dir)).find((entry) => entry.endsWith(".app"));
    if (!bundle) {
      throw new Error(`Update ${tag} archive contains no app bundle`);
    }
    return { tag, bundlePath: path.join(dir, bundle) };
  }
}
