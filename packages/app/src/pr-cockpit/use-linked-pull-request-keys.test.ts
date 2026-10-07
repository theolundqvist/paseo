import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import { collectLinkedPullRequestKeys } from "./use-linked-pull-request-keys";

const timestamp = new Date("2026-10-07T00:00:00Z");

function user(id: string, text: string): StreamItem {
  return { kind: "user_message", id, text, timestamp };
}

function assistant(id: string, text: string): StreamItem {
  return { kind: "assistant_message", id, text, timestamp };
}

describe("collectLinkedPullRequestKeys", () => {
  it("lists head mentions before tail mentions, newest message first", () => {
    expect(
      collectLinkedPullRequestKeys({
        tail: [
          user("u1", "Review https://github.com/acme/api/pull/1"),
          assistant("a1", "Opened prcockpit://pr/acme/api/2"),
        ],
        head: [assistant("a2", "Updated https://github.com/acme/web/pull/3/files")],
      }),
    ).toEqual(["acme/web#3", "acme/api#2", "acme/api#1"]);
  });

  it("keeps a pull request at its most recent mention", () => {
    expect(
      collectLinkedPullRequestKeys({
        tail: [
          assistant("a1", "prcockpit://pr/acme/api/1 prcockpit://pr/acme/api/2"),
          user("u1", "What about https://github.com/acme/api/pull/1?"),
        ],
        head: [],
      }),
    ).toEqual(["acme/api#1", "acme/api#2"]);
  });

  it("ignores links outside user and assistant messages", () => {
    const thought: StreamItem = {
      kind: "thought",
      id: "t1",
      text: "prcockpit://pr/acme/api/9",
      timestamp,
      status: "ready",
    };
    expect(collectLinkedPullRequestKeys({ tail: [thought], head: [] })).toEqual([]);
  });

  it("stops at 100 pull requests", () => {
    const text = Array.from({ length: 150 }, (_, index) => `prcockpit://pr/acme/api/${index + 1}`);
    const keys = collectLinkedPullRequestKeys({
      tail: [assistant("a1", text.join(" "))],
      head: [],
    });
    expect(keys).toHaveLength(100);
    expect(keys[0]).toBe("acme/api#150");
  });
});
