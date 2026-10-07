import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: {}, autoUpdater: {} }));

import { selectLatestForkUpdate, type GitHubRelease } from "./fork-mac-app-update-runtime";

function release(tag: string, publishedAt: string, overrides: Partial<GitHubRelease> = {}) {
  return {
    tag_name: tag,
    draft: false,
    published_at: publishedAt,
    body: null,
    assets: [
      {
        name: "Paseo-0.11.0-beta.5-arm64.zip",
        digest: `sha256:${tag}`,
        browser_download_url: `https://example.test/${tag}.zip`,
      },
    ],
    ...overrides,
  };
}

describe("selectLatestForkUpdate", () => {
  it("picks the most recently published installable fork release regardless of list order", () => {
    const releases: GitHubRelease[] = [
      release("fork-draft01", "2026-10-09T00:00:00Z", { draft: true }),
      release("fork-intel01", "2026-10-08T12:00:00Z", {
        assets: [
          {
            name: "Paseo-0.11.0-beta.5-x64.zip",
            digest: "sha256:x",
            browser_download_url: "https://example.test/x64.zip",
          },
        ],
      }),
      release("v0.12.0", "2026-10-08T06:00:00Z"),
      release("fork-older01", "2026-10-06T13:30:50Z"),
      release("fork-newer01", "2026-10-07T14:57:01Z"),
      release("fork-oldest1", "2026-10-05T09:00:00Z"),
    ];

    const update = selectLatestForkUpdate(releases, "arm64");

    expect(update?.info.version).toBe("fork-newer01");
    expect(update?.asset.browser_download_url).toBe("https://example.test/fork-newer01.zip");
  });

  it("returns null when no release carries a zip for this architecture", () => {
    expect(selectLatestForkUpdate([release("fork-only01", "2026-10-07T00:00:00Z")], "x64")).toBe(
      null,
    );
  });
});
