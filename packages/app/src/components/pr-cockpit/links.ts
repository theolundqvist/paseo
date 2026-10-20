import type { TerminalState } from "@getpaseo/protocol/messages";

const COCKPIT_URL = /^prcockpit:\/\/pr\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\/[1-9][0-9]*$/;
const TOKEN_CHARACTER = /[A-Za-z0-9_./:?#%&=+~-]/;
const MAX_TOKEN_LENGTH = 2048;

function cockpitUrl(token: string): string | null {
  const url = token.replace(/[.]+$/, "");
  return COCKPIT_URL.test(url) ? url : null;
}

/** Keeps only the unfinished token/control sequence, never the terminal buffer. */
export class CockpitLinkScanner {
  private links = new Set<string>();
  private token = "";
  private tokenOverflow = false;
  private control = "";
  private controlOverflow = false;
  private mode: "text" | "escape" | "csi" | "osc" | "osc-escape" = "text";
  private publishedLinks: string[] = [];
  private publishedSize = 0;
  private publishedPending: string | null = null;

  constructor(state?: TerminalState) {
    if (!state) return;
    // A cursor inside existing content must not split a visible URL into a
    // different target. Only the blank suffix of a logical line is appendable.
    let cursorAtLineEnd = true;
    for (let index = state.cursor.row; index < state.grid.length; index++) {
      const startCol = index === state.cursor.row ? state.cursor.col : 0;
      const hasSuffix = state.grid[index]!.some(
        (cell, col) => col >= startCol && /\S/.test(cell.char),
      );
      if (hasSuffix) {
        cursorAtLineEnd = false;
        break;
      }
      if (!state.gridWrapped?.[index]) break;
    }
    let pendingToken = "";
    let pendingOverflow = false;
    for (const [rows, wrapped] of [
      [state.scrollback, state.scrollbackWrapped],
      [state.grid, state.gridWrapped],
    ] as const) {
      rows.forEach((row, index) => {
        const isPendingCursorRow =
          cursorAtLineEnd && rows === state.grid && index === state.cursor.row;
        const cursorCol = Math.min(state.cursor.col, row.length);
        row.forEach((cell, col) => {
          if (isPendingCursorRow && col === cursorCol) {
            pendingToken = this.token;
            pendingOverflow = this.tokenOverflow;
            this.token = "";
            this.tokenOverflow = false;
          }
          this.write(cell.char);
        });
        if (isPendingCursorRow && cursorCol === row.length) {
          pendingToken = this.token;
          pendingOverflow = this.tokenOverflow;
          this.token = "";
          this.tokenOverflow = false;
        }
        if (!wrapped?.[index]) this.write("\n");
      });
    }
    this.finishToken();
    // Snapshot columns are cells (not string offsets); xterm's cursor points at
    // the next write, including col === cols when a soft wrap is still pending.
    // Padding and rows below it must not commit the cursor-adjacent token.
    this.token = pendingToken;
    this.tokenOverflow = pendingOverflow;
  }

  write(text: string): void {
    for (const char of text) {
      if (this.mode === "osc" || this.mode === "osc-escape") {
        this.writeOscCharacter(char);
        continue;
      }
      if (this.mode === "csi") {
        if (char >= "@" && char <= "~") {
          // SGR changes presentation without breaking a printed URL.
          if (char !== "m") this.finishToken();
          this.mode = "text";
        }
        continue;
      }
      if (this.mode === "escape") {
        if (char === "[") this.mode = "csi";
        else if (char === "]") {
          this.finishToken();
          this.control = "";
          this.controlOverflow = false;
          this.mode = "osc";
        } else {
          this.finishToken();
          this.mode = "text";
        }
        continue;
      }
      if (char === "\x1b") this.mode = "escape";
      else if (char === "\x9b") this.mode = "csi";
      else if (char === "\x9d") {
        this.finishToken();
        this.control = "";
        this.controlOverflow = false;
        this.mode = "osc";
      } else if (TOKEN_CHARACTER.test(char)) {
        if (this.token.length < MAX_TOKEN_LENGTH) this.token += char;
        else this.tokenOverflow = true;
      } else this.finishToken();
    }
  }

  getLinks(): string[] {
    const candidate = this.tokenOverflow ? null : cockpitUrl(this.token);
    const pending = candidate && !this.links.has(candidate) ? candidate : null;
    if (this.publishedSize === this.links.size && this.publishedPending === pending) {
      return this.publishedLinks;
    }
    // Committing the visible pending URL at a delimiter does not change the set.
    const committedPending =
      this.publishedPending !== null &&
      pending === null &&
      this.links.size === this.publishedSize + 1 &&
      this.links.has(this.publishedPending);
    if (!committedPending) {
      this.publishedLinks = [...this.links];
      if (pending) this.publishedLinks.push(pending);
    }
    this.publishedSize = this.links.size;
    this.publishedPending = pending;
    return this.publishedLinks;
  }

  private writeOscCharacter(char: string): void {
    const isTerminator =
      char === "\x07" || char === "\x9c" || (this.mode === "osc-escape" && char === "\\");
    if (this.mode === "osc-escape" && char !== "\\") this.appendControl("\x1b");
    if (isTerminator) {
      const target = this.controlOverflow ? null : /^8;[^;]*;([\s\S]*)$/.exec(this.control)?.[1];
      // Explicit targets are not prose: punctuation or controls must not be
      // trimmed into a different URL, including a final newline matched by `$`.
      if (target && COCKPIT_URL.exec(target)?.[0] === target) this.links.add(target);
      this.control = "";
      this.controlOverflow = false;
      this.mode = "text";
    } else if (char === "\x1b") {
      this.mode = "osc-escape";
    } else {
      this.appendControl(char);
      this.mode = "osc";
    }
  }

  private appendControl(char: string): void {
    if (this.control.length < MAX_TOKEN_LENGTH) this.control += char;
    else this.controlOverflow = true;
  }

  private add(token: string): void {
    const url = cockpitUrl(token);
    if (url) this.links.add(url);
  }

  private finishToken(): void {
    if (!this.tokenOverflow) this.add(this.token);
    this.token = "";
    this.tokenOverflow = false;
  }
}

export function findCockpitLinks(text: string): string[] {
  const scanner = new CockpitLinkScanner();
  scanner.write(text);
  return scanner.getLinks();
}

export function createTerminalCockpitLinks(initialSnapshot?: TerminalState | null) {
  let scanner = new CockpitLinkScanner();
  let decoder = new TextDecoder();
  let links: readonly string[] = [];
  let scannedLinks: readonly string[] | null = null;
  const listeners = new Set<() => void>();

  function publish(): void {
    const next = scanner.getLinks();
    if (next === scannedLinks) return;
    scannedLinks = next;
    if (next.length === links.length) {
      const previous = new Set(links);
      if (next.every((url) => previous.has(url))) return;
    }
    links = next;
    for (const listener of listeners) listener();
  }

  function restore(data: Uint8Array): void {
    scanner = new CockpitLinkScanner();
    decoder = new TextDecoder();
    scanner.write(decoder.decode(data, { stream: true }));
    publish();
  }

  function snapshot(state: TerminalState): void {
    scanner = new CockpitLinkScanner(state);
    decoder = new TextDecoder();
    publish();
  }

  if (initialSnapshot) snapshot(initialSnapshot);
  return {
    getSnapshot: () => links,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    write(data: Uint8Array) {
      scanner.write(decoder.decode(data, { stream: true }));
      publish();
    },
    restore,
    snapshot,
    clear() {
      restore(new Uint8Array());
    },
  };
}
