const OWNER = "[A-Za-z0-9][A-Za-z0-9-]{0,38}";
const REPO = "[A-Za-z0-9._-]{1,100}";
const NUMBER = "[0-9]{1,10}";

const PULL_REQUEST_REFERENCE = new RegExp(
  `(?<![\\w.+-])prcockpit://pr/(${OWNER})/(${REPO})/(${NUMBER})(?![\\w-])` +
    `|https?://(?:www\\.)?github\\.com/(${OWNER})/(${REPO})/pull/(${NUMBER})(?![\\w-])`,
  "gi",
);

function toPullRequestKey(match: RegExpMatchArray): string | null {
  const owner = match[1] ?? match[4];
  const repo = match[2] ?? match[5];
  const number = Number(match[3] ?? match[6]);
  if (owner === undefined || repo === undefined) {
    return null;
  }
  const isReservedRepoName = repo === "." || repo === "..";
  if (isReservedRepoName || number < 1) {
    return null;
  }
  return `${owner}/${repo}#${number}`;
}

/** Pull requests referenced in `text` as `owner/repo#N`, the most recently mentioned first. */
export function extractPullRequestKeys(text: string): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const match of [...text.matchAll(PULL_REQUEST_REFERENCE)].toReversed()) {
    const key = toPullRequestKey(match);
    if (key === null || seen.has(key.toLowerCase())) {
      continue;
    }
    seen.add(key.toLowerCase());
    keys.push(key);
  }
  return keys;
}
