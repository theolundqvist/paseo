import { describe, expect, it } from "vitest";
import { extractPullRequestKeys } from "./pull-request-keys";

describe("extractPullRequestKeys", () => {
  it("normalizes PR Cockpit and GitHub pull request links", () => {
    expect(
      extractPullRequestKeys(
        "Opened prcockpit://pr/getpaseo/paseo/42 and https://github.com/theo/pr-cockpit/pull/7",
      ),
    ).toEqual(["theo/pr-cockpit#7", "getpaseo/paseo#42"]);
  });

  it("reads links inside markdown link syntax", () => {
    expect(
      extractPullRequestKeys(
        "See [#12](prcockpit://pr/acme/api/12) and [the PR](https://github.com/acme/web/pull/3).",
      ),
    ).toEqual(["acme/web#3", "acme/api#12"]);
  });

  it("stops at trailing punctuation and closing parentheses", () => {
    expect(
      extractPullRequestKeys(
        "(https://github.com/acme/api/pull/5), https://github.com/acme/api/pull/6. prcockpit://pr/acme/api/7!",
      ),
    ).toEqual(["acme/api#7", "acme/api#6", "acme/api#5"]);
  });

  it("accepts sub-pages, anchors, and queries after the pull request number", () => {
    expect(
      extractPullRequestKeys(
        [
          "https://github.com/acme/api/pull/8/files",
          "https://github.com/acme/api/pull/9/commits/abc123",
          "https://github.com/acme/api/pull/10#discussion_r1",
          "https://www.github.com/acme/api/pull/11?w=1",
        ].join(" "),
      ),
    ).toEqual(["acme/api#11", "acme/api#10", "acme/api#9", "acme/api#8"]);
  });

  it("lists each pull request once, ordered by its latest mention", () => {
    expect(
      extractPullRequestKeys(
        "https://github.com/acme/api/pull/1 prcockpit://pr/acme/api/2 prcockpit://pr/acme/api/1 https://github.com/Acme/API/pull/2/files",
      ),
    ).toEqual(["Acme/API#2", "acme/api#1"]);
  });

  it("keeps dots, underscores, and hyphens in repository names", () => {
    expect(extractPullRequestKeys("https://github.com/my-org/my_repo.js/pull/4")).toEqual([
      "my-org/my_repo.js#4",
    ]);
  });

  it("ignores owners and repositories GitHub cannot have", () => {
    expect(
      extractPullRequestKeys(
        [
          "https://github.com/bad_owner/repo/pull/1",
          "https://github.com/-owner/repo/pull/2",
          "https://github.com/owner/re%20po/pull/3",
          "https://github.com/owner/../pull/4",
          "prcockpit://pr/owner/re po/5",
          "prcockpit://pr/own.er/repo/6",
        ].join(" "),
      ),
    ).toEqual([]);
  });

  it("ignores GitHub links that are not pull requests", () => {
    expect(
      extractPullRequestKeys(
        [
          "https://github.com/acme/api/issues/1",
          "https://github.com/acme/api/commit/abc1234",
          "https://github.com/acme/api/pulls",
          "https://github.com/acme/api/pull/new/feature",
          "https://github.com/acme/api/pull/12abc",
          "https://github.com/acme/api/pull/0",
          "https://gist.github.com/acme/api/pull/1",
          "https://github.com.evil.test/acme/api/pull/1",
          "github.com/acme/api/pull/1",
          "acme/api#1",
        ].join(" "),
      ),
    ).toEqual([]);
  });

  it("ignores schemes that only end in prcockpit", () => {
    expect(extractPullRequestKeys("notprcockpit://pr/acme/api/1")).toEqual([]);
  });
});
