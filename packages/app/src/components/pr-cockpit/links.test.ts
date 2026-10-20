import { describe, expect, it } from "vitest";
import type { TerminalState } from "@getpaseo/protocol/messages";
import { CockpitLinkScanner, createTerminalCockpitLinks, findCockpitLinks } from "./links";

const URL = "prcockpit://pr/getpaseo/paseo/123";
const encode = (text: string) => new TextEncoder().encode(text);

function cells(text: string): TerminalState["grid"][number] {
  return [...text].map((char) => ({ char }));
}

describe("Cockpit pane links", () => {
  it.each(["\x07", "\x1b\\"])("detects OSC8 targets at every chunk boundary (%j)", (end) => {
    const output = `\x1b]8;id=review;${URL}${end}Review\x1b]8;;${end}`;
    for (let split = 0; split <= output.length; split++) {
      const scanner = new CockpitLinkScanner();
      scanner.write(output.slice(0, split));
      scanner.write(output.slice(split));
      expect(scanner.getLinks()).toEqual([URL]);
    }
    const scanner = new CockpitLinkScanner();
    for (const char of output) scanner.write(char);
    expect(scanner.getLinks()).toEqual([URL]);
  });

  it("handles byte-wise plain links, split SGR, and repeated OSC8/plain output", () => {
    const source = createTerminalCockpitLinks();
    const output = `${URL}\n\x1b]8;;${URL}\x07Review\x1b]8;;\x07\nprcockpit://pr/getpaseo/\x1b[32mpaseo/123\x1b[0m\n`;
    for (const byte of encode(output)) source.write(Uint8Array.of(byte));
    expect(source.getSnapshot()).toEqual([URL]);
    const snapshot = source.getSnapshot();
    source.write(encode(`${URL}\n`));
    expect(source.getSnapshot()).toBe(snapshot);
  });

  it("does not retain a partial PR number from an earlier chunk", () => {
    const scanner = new CockpitLinkScanner();
    scanner.write("prcockpit://pr/getpaseo/paseo/1");
    expect(scanner.getLinks()).toEqual(["prcockpit://pr/getpaseo/paseo/1"]);
    scanner.write("23\n");
    expect(scanner.getLinks()).toEqual([URL]);
  });

  it("finds real history links but not GitHub URLs or malformed Cockpit targets", () => {
    expect(findCockpitLinks(`[Review](${URL}).\n${URL}`)).toEqual([URL]);
    expect(
      findCockpitLinks(
        [
          "https://github.com/getpaseo/paseo/pull/123",
          "prcockpit://pr/getpaseo/paseo/0",
          "prcockpit://pr/getpaseo/paseo/123abc",
          "prcockpit://other/getpaseo/paseo/123",
          "notprcockpit://pr/getpaseo/paseo/123",
          "prcockpit://pr/getpaseo/paseo/123/extra",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("reads an initial snapshot across scrollback/grid soft wraps and resets on restore", () => {
    const source = createTerminalCockpitLinks({
      rows: 1,
      cols: 24,
      scrollback: [cells("prcockpit://pr/getpaseo/")],
      scrollbackWrapped: [true],
      grid: [cells("paseo/123")],
      gridWrapped: [false],
      cursor: { row: 0, col: 9 },
    });
    expect(source.getSnapshot()).toEqual([URL]);
    source.restore(encode(`\x1b]8;;${URL}\x1b\\Review\x1b]8;;\x1b\\`));
    expect(source.getSnapshot()).toEqual([URL]);
    source.restore(encode("another screen"));
    expect(source.getSnapshot()).toEqual([]);
  });

  it("keeps parser state and discovered URLs isolated between panes", () => {
    const left = createTerminalCockpitLinks();
    const right = createTerminalCockpitLinks();
    left.write(encode("prcockpit://pr/getpaseo/"));
    right.write(encode("paseo/123\n"));
    expect(right.getSnapshot()).toEqual([]);
    left.write(encode("paseo/123\n"));
    expect(left.getSnapshot()).toEqual([URL]);
    expect(right.getSnapshot()).toEqual([]);
    left.clear();
    expect(left.getSnapshot()).toEqual([]);
  });
});
