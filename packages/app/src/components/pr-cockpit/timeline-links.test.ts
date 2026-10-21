import { describe, expect, it, vi } from "vitest";
import type { AssistantMessageItem, StreamItem, ThoughtItem } from "@/types/stream";
import { createTimelineCockpitLinkSelector } from "./timeline-links";

// These tests exercise the selector, without loading native presentation dependencies.
vi.mock("./pane-links", () => ({ PaneCockpitLinks: () => null }));

const PREFIX = "prcockpit://pr/example/repo/";
const URL = `${PREFIX}123`;

function assistant(text: string, id = "assistant"): AssistantMessageItem {
  return { kind: "assistant_message", id, text, timestamp: new Date(0) };
}

function thought(text: string): ThoughtItem {
  return { kind: "thought", id: "thought", text, status: "loading", timestamp: new Date(0) };
}

describe("timeline Cockpit links", () => {
  it("continues immutable assistant replacements without retaining partial PR numbers", () => {
    const select = createTimelineCockpitLinkSelector();
    const history = assistant(`${PREFIX}9\n`, "history");
    expect(select([history, assistant(`${PREFIX}1`)])).toEqual([`${PREFIX}9`, `${PREFIX}1`]);
    expect(select([history, assistant(`${URL}\n`)])).toEqual([`${PREFIX}9`, URL]);
    const visible = select([history, assistant(`${URL}\nmore output`)]);
    expect(select([history, assistant(`${URL}\nmore output\n`)])).toBe(visible);
  });

  it.each(["\x07", "\x1b\\", "\x9c"])(
    "continues split OSC8 controls through immutable replacements (%j)",
    (end) => {
      const select = createTimelineCockpitLinkSelector();
      const opening = `\x1b]8;;${URL}${end}`;
      const output = `${opening}Review\x1b]8;;${end}`;
      for (let length = 1; length <= output.length; length++) {
        expect(select([assistant(output.slice(0, length))])).toEqual(
          length < opening.length ? [] : [URL],
        );
      }
    },
  );

  it("resets on non-prefix edits, truncation, and cached older versions", () => {
    const select = createTimelineCockpitLinkSelector();
    const first = assistant(`${URL}\nold prose`);
    const replacement = assistant(`${PREFIX}456\nreplacement prose`);
    expect(select([first])).toEqual([URL]);
    expect(select([replacement])).toEqual([`${PREFIX}456`]);
    expect(select([assistant(`${PREFIX}4`)])).toEqual([`${PREFIX}4`]);
    expect(select([assistant(`${PREFIX}45`)])).toEqual([`${PREFIX}45`]);
    expect(select([first])).toEqual([URL]);
    expect(select([assistant(`${first.text}\n${PREFIX}789`)])).toEqual([URL, `${PREFIX}789`]);
    expect(select([assistant("no links remain")])).toEqual([]);
  });

  it("retains references when the visible set is unchanged, including reordered history", () => {
    const select = createTimelineCockpitLinkSelector();
    const history = assistant(`${PREFIX}9\n`, "history");
    const live = assistant(`${URL}\n`);
    const visible = select([history, live]);
    expect(select([history, assistant(`${URL}\nordinary prose`)])).toBe(visible);
    expect(select([assistant(`${URL}\nordinary prose`), history])).toBe(visible);
    expect(select([history, assistant(`${URL}\n${PREFIX}9\n`)])).toBe(visible);
  });

  it("isolates stream IDs and selectors, and discards removed active items", () => {
    const select = createTimelineCockpitLinkSelector();
    const other = createTimelineCockpitLinkSelector();
    expect(select([assistant(PREFIX, "old")])).toEqual([]);
    expect(select([assistant("123\n", "new")])).toEqual([]);
    expect(other([assistant("123\n", "old")])).toEqual([]);
    expect(select([assistant(URL, "old")])).toEqual([URL]);
    expect(select([])).toEqual([]);
    expect(select([assistant("123\n", "old")])).toEqual([]);
  });

  it("keeps assistant and thought continuations independent across an interrupting user row", () => {
    const select = createTimelineCockpitLinkSelector();
    const user: StreamItem = {
      kind: "user_message",
      id: "user",
      text: "continue",
      timestamp: new Date(0),
    };
    expect(select([thought(`${PREFIX}4`), assistant(`${PREFIX}1`), user])).toEqual([
      `${PREFIX}4`,
      `${PREFIX}1`,
    ]);
    expect(select([thought(`${PREFIX}456\n`), assistant(`${URL}\n`), user])).toEqual([
      `${PREFIX}456`,
      URL,
    ]);
    expect(select([thought("no thought link"), assistant(`${URL}\n`), user])).toEqual([URL]);
  });

  it("updates replaced completed history without leaking its prior links", () => {
    const select = createTimelineCockpitLinkSelector();
    const live = assistant("live prose");
    expect(select([assistant(`${PREFIX}9\n`, "history"), live])).toEqual([`${PREFIX}9`]);
    expect(select([assistant(`${PREFIX}8\n`, "history"), live])).toEqual([`${PREFIX}8`]);
    expect(select([live])).toEqual([]);
  });
});
