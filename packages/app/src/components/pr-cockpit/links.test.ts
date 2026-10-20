import { describe, expect, it } from "vitest";
import { Terminal as HeadlessTerminal } from "@xterm/headless";
import type { TerminalState } from "@getpaseo/protocol/messages";
import { CockpitLinkScanner, createTerminalCockpitLinks, findCockpitLinks } from "./links";

const URL = "prcockpit://pr/getpaseo/paseo/123";
const encode = (text: string) => new TextEncoder().encode(text);

function cells(text: string): TerminalState["grid"][number] {
  return [...text].map((char) => ({ char }));
}

function extractSnapshot(terminal: HeadlessTerminal): TerminalState {
  const buffer = terminal.buffer.active;
  const rows: TerminalState["grid"] = [];
  const wrapped: boolean[] = [];
  for (let row = 0; row < buffer.baseY + terminal.rows; row++) {
    const line = buffer.getLine(row);
    const rowCells: TerminalState["grid"][number] = [];
    for (let col = 0; col < terminal.cols; col++) {
      rowCells.push({ char: line?.getCell(col)?.getChars() || " " });
    }
    rows.push(rowCells);
    // Protocol flags describe continuation TO the next row, not FROM the last.
    wrapped.push(buffer.getLine(row + 1)?.isWrapped === true);
  }
  return {
    rows: terminal.rows,
    cols: terminal.cols,
    scrollback: rows.slice(0, buffer.baseY),
    scrollbackWrapped: wrapped.slice(0, buffer.baseY),
    grid: rows.slice(buffer.baseY),
    gridWrapped: wrapped.slice(buffer.baseY),
    cursor: { row: buffer.cursorY, col: buffer.cursorX },
  };
}
describe("Cockpit pane links", () => {
  it.each([
    ["\x1b]", "\x07"],
    ["\x1b]", "\x1b\\"],
    ["\x9d", "\x9c"],
  ])("detects OSC8 targets at every chunk boundary (%j, %j)", (start, end) => {
    const output = `${start}8;id=review;${URL}${end}Review${start}8;;${end}`;
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

  it.each([
    ["\x1b]", "\x07"],
    ["\x1b]", "\x1b\\"],
    ["\x9d", "\x9c"],
  ])("validates explicit OSC8 targets verbatim (%j, %j)", (start, end) => {
    for (const target of [
      `${URL}.`,
      `${URL}..`,
      `${URL}\n`,
      `${URL}\r`,
      `${URL} `,
      `${URL}?review=true`,
      `${URL}\x1b.`,
      `${URL}${"1".repeat(2048)}.`,
    ]) {
      const output = `${start}8;;${target}${end}Review${start}8;;${end}`;
      for (let split = 0; split <= output.length; split++) {
        const scanner = new CockpitLinkScanner();
        scanner.write(output.slice(0, split));
        scanner.write(output.slice(split));
        expect(scanner.getLinks()).toEqual([]);
      }
    }
    expect(findCockpitLinks(`${URL}.`)).toEqual([URL]);
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

  it.each([8, 28, 29, 30, 80])(
    "continues cell snapshots at cursor/wrap boundaries with %i columns",
    async (cols) => {
      const prefix = "prcockpit://pr/example/repo/";
      const earlier = `${prefix}9`;
      for (const rows of [1, 3]) {
        for (const number of ["", "1"]) {
          const terminal = new HeadlessTerminal({ cols, rows, allowProposedApi: true });
          try {
            await new Promise<void>((resolve) => {
              terminal.write(`${earlier}\r\n${prefix}${number}`, resolve);
            });
            const source = createTerminalCockpitLinks(extractSnapshot(terminal));
            expect(source.getSnapshot()).toEqual(number ? [earlier, `${prefix}1`] : [earlier]);
            source.write(encode(number ? "23\n" : "123\n"));
            expect(source.getSnapshot()).toEqual([earlier, `${prefix}123`]);
          } finally {
            terminal.dispose();
          }
        }
      }
    },
  );

  it("uses cell columns rather than string offsets and keeps rows below the cursor", async () => {
    const terminal = new HeadlessTerminal({ cols: 80, rows: 3, allowProposedApi: true });
    try {
      const prefix = "prcockpit://pr/example/repo/";
      const cursorCol = 2 + prefix.length + 1;
      await new Promise<void>((resolve) => {
        terminal.write(`e\u0301 ${prefix}1\r\n${URL}\x1b[1;${cursorCol + 1}H`, resolve);
      });
      const state = extractSnapshot(terminal);
      // e + combining acute occupies one cell, not two string code units.
      expect(state.cursor).toEqual({ row: 0, col: cursorCol });
      const source = createTerminalCockpitLinks(state);
      source.write(encode("23\n"));
      expect(source.getSnapshot()).toEqual([URL, `${prefix}123`]);
    } finally {
      terminal.dispose();
    }
  });

  it.each([20, 80])(
    "keeps intact visible URLs with the cursor inside them (%i columns)",
    async (cols) => {
      const url = "prcockpit://pr/example/repo/123";
      for (const offset of [url.indexOf("example") + 2, url.length - 1]) {
        const terminal = new HeadlessTerminal({ cols, rows: 3, allowProposedApi: true });
        try {
          const row = Math.floor(offset / cols);
          const col = offset % cols;
          await new Promise<void>((resolve) => {
            terminal.write(`${url}\x1b[${row + 1};${col + 1}H`, resolve);
          });
          const source = createTerminalCockpitLinks(extractSnapshot(terminal));
          expect(source.getSnapshot()).toEqual([url]);
          source.write(encode("\n"));
          expect(source.getSnapshot()).toEqual([url]);
        } finally {
          terminal.dispose();
        }
      }
    },
  );

  it("keeps an intact URL whose cursor suffix starts on the next soft-wrapped row", async () => {
    const url = "prcockpit://pr/example/repo/123";
    const terminal = new HeadlessTerminal({ cols: 20, rows: 3, allowProposedApi: true });
    try {
      await new Promise<void>((resolve) => {
        // Reprinting the last cell leaves a pending-wrap cursor at col === cols,
        // with the rest of this existing logical line still on the next row.
        terminal.write(`${url}\x1b[1;20H${url[19]}`, resolve);
      });
      const state = extractSnapshot(terminal);
      expect(state.cursor).toEqual({ row: 0, col: 20 });
      const source = createTerminalCockpitLinks(state);
      expect(source.getSnapshot()).toEqual([url]);
    } finally {
      terminal.dispose();
    }
  });

  it.each([" ", "\r\n"])("does not extend a token separated from the cursor by %j", async (end) => {
    const terminal = new HeadlessTerminal({ cols: 80, rows: 3, allowProposedApi: true });
    try {
      await new Promise<void>((resolve) => {
        terminal.write(`${URL}${end}`, resolve);
      });
      const source = createTerminalCockpitLinks(extractSnapshot(terminal));
      source.write(encode("4\n"));
      expect(source.getSnapshot()).toEqual([URL]);
    } finally {
      terminal.dispose();
    }
  });

  it("continues unfinished tokens after a raw restore", () => {
    const source = createTerminalCockpitLinks();
    source.restore(encode("prcockpit://pr/example/repo/1"));
    source.write(encode("23\n"));
    expect(source.getSnapshot()).toEqual(["prcockpit://pr/example/repo/123"]);
  });

  it("keeps snapshots and notifications stable when visible links do not change", () => {
    const source = createTerminalCockpitLinks();
    let changes = 0;
    const unsubscribe = source.subscribe(() => changes++);
    source.write(encode(URL));
    const visible = source.getSnapshot();
    source.write(encode("\nordinary output\n"));
    source.write(encode(`${URL}\n`));
    source.restore(encode(`${URL}\n`));
    source.write(encode("more output\n"));
    expect(source.getSnapshot()).toBe(visible);
    expect(changes).toBe(1);
    unsubscribe();
    source.clear();
    expect(changes).toBe(1);
  });

  it("retains scanner results when a pending link commits or unrelated text arrives", () => {
    const scanner = new CockpitLinkScanner();
    scanner.write(URL);
    const visible = scanner.getLinks();
    scanner.write("\n");
    expect(scanner.getLinks()).toBe(visible);
    scanner.write("ordinary output\n");
    expect(scanner.getLinks()).toBe(visible);
    scanner.write(`${URL}\n`);
    expect(scanner.getLinks()).toBe(visible);
  });

  it("keeps the visible reference when restored links arrive in a different order", () => {
    const source = createTerminalCockpitLinks();
    const other = "prcockpit://pr/example/repo/9";
    source.write(encode(`${URL}\n${other}\n`));
    const visible = source.getSnapshot();
    source.restore(encode(`${other}\n${URL}\n`));
    expect(source.getSnapshot()).toBe(visible);
    source.write(encode("ordinary output\n"));
    expect(source.getSnapshot()).toBe(visible);
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
