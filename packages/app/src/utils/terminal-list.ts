import type { CreateTerminalResponse, ListTerminalsResponse } from "@getpaseo/protocol/messages";

type TerminalListEntry = ListTerminalsResponse["payload"]["terminals"][number];
type CreatedTerminal = NonNullable<CreateTerminalResponse["payload"]["terminal"]>;

export function upsertTerminalListEntry(input: {
  terminals: TerminalListEntry[];
  terminal: CreatedTerminal;
}): TerminalListEntry[] {
  const createdTerminal = input.terminal;
  const existingIndex = input.terminals.findIndex((terminal) => terminal.id === createdTerminal.id);

  if (existingIndex < 0) {
    return [...input.terminals, createdTerminal];
  }

  const nextTerminals = [...input.terminals];
  nextTerminals[existingIndex] = createdTerminal;
  return nextTerminals;
}
