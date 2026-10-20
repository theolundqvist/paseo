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
  private mode: "text" | "escape" | "csi" | "osc" | "osc-escape" = "text";

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
        this.mode = "osc";
      } else if (TOKEN_CHARACTER.test(char)) {
        if (this.token.length < MAX_TOKEN_LENGTH) this.token += char;
        else this.tokenOverflow = true;
      } else this.finishToken();
    }
  }

  getLinks(): string[] {
    const links = [...this.links];
    // A final printed URL need not have a newline. Do not commit it yet: the next
    // frame could extend PR 12 to PR 123, and must not leave a bogus #12 chip.
    const pending = this.tokenOverflow ? null : cockpitUrl(this.token);
    if (pending && !this.links.has(pending)) links.push(pending);
    return links;
  }

  private writeOscCharacter(char: string): void {
    const isTerminator =
      char === "\x07" || char === "\x9c" || (this.mode === "osc-escape" && char === "\\");
    if (isTerminator) {
      const target = /^8;[^;]*;(.*)$/.exec(this.control)?.[1];
      if (target) this.add(target);
      this.control = "";
      this.mode = "text";
    } else if (char === "\x1b") {
      this.mode = "osc-escape";
    } else {
      if (this.control.length <= MAX_TOKEN_LENGTH) this.control += char;
      this.mode = "osc";
    }
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
  const listeners = new Set<() => void>();

  function publish(): void {
    const next = scanner.getLinks();
    if (next.length === links.length && next.every((url, index) => url === links[index])) return;
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
    scanner = new CockpitLinkScanner();
    decoder = new TextDecoder();
    for (const [rows, wrapped] of [
      [state.scrollback, state.scrollbackWrapped],
      [state.grid, state.gridWrapped],
    ] as const) {
      rows.forEach((row, index) => {
        scanner.write(row.map((cell) => cell.char).join(""));
        if (!wrapped?.[index]) scanner.write("\n");
      });
    }
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
