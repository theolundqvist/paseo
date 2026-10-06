import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type {
  AnswerRow,
  AnswersForCwd,
  answersListRpc,
  answersMarkReadRpc,
} from "../shared/answers.js";

const RECENT_LIMIT = 200;
const run = promisify(execFile);
const LOCK_POLL_MS = 50;
const LOCK_TRIES = 100;

// POSIX cksum (CRC-32, polynomial 0x04C11DB7, length appended): the answers script names
// each cwd's cursor file `cursor.<cksum of canonical cwd>`.
const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let crc = index << 24;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
  }
  return crc >>> 0;
});

export function cksum(bytes: Uint8Array): number {
  let crc = 0;
  const step = (byte: number) => {
    crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ byte) & 0xff]!) >>> 0;
  };
  for (const byte of bytes) step(byte);
  for (let length = bytes.length; length > 0; length = Math.floor(length / 256)) {
    step(length & 0xff);
  }
  return ~crc >>> 0;
}

// Mirrors the script's `realpath`, which resolves a missing last component.
async function canonicalCwd(cwd: string): Promise<string> {
  try {
    return await realpath(cwd);
  } catch {
    try {
      return path.join(await realpath(path.dirname(cwd)), path.basename(cwd));
    } catch {
      return cwd;
    }
  }
}

async function readOptional(file: string): Promise<Buffer | null> {
  try {
    return await readFile(file);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

interface KeyedRow extends AnswerRow {
  key: string;
}

/** Rows with a cwd column, as awk `NF>=5` sees them; `order` is `base` plus the line's byte offset. */
function parseRows(bytes: Buffer, base: number): KeyedRow[] {
  const rows: KeyedRow[] = [];
  let start = 0;
  while (start < bytes.length) {
    const newline = bytes.indexOf(0x0a, start);
    const end = newline === -1 ? bytes.length : newline;
    const fields = bytes.subarray(start, end).toString("utf8").split("\t");
    if (fields.length >= 5) {
      rows.push({
        order: base + start,
        time: fields[0]!,
        label: fields[2]!,
        text: fields[3]!,
        key: fields[4]!,
      });
    }
    start = end + 1;
  }
  return rows;
}

interface AnswersSnapshot {
  log: Buffer | null;
  rotated: Buffer | null;
  cursors: ReadonlyMap<string, Buffer>;
}

function unreadRows(key: string, { log, rotated, cursors }: AnswersSnapshot): AnswerRow[] {
  if (!log) return [];
  const size = log.length;
  const cursor = cursors.get(`cursor.${cksum(Buffer.from(key))}`);
  const value = cursor?.toString("utf8") ?? "0";
  let start = /^[0-9]+$/.test(value) ? Number(value) : 0;
  if (start > size) start = 0;
  if (cursor && start === size) return [];
  const rotatedBase = rotated?.length ?? 0;
  const rows = [
    ...(!cursor && rotated ? parseRows(rotated, 0) : []),
    ...parseRows(log.subarray(start), rotatedBase + start),
  ];
  return rows.filter((row) => row.key === key).map(({ key: _key, ...row }) => row);
}

// Compaction rewrites log, log.1 and every cursor under the script's `mkdir` lock, so the
// snapshot is taken under the same lock to never pair one generation with another's cursor.
async function readSnapshot(dir: string): Promise<AnswersSnapshot> {
  const lock = path.join(dir, ".lock");
  for (let tries = 0; ; tries++) {
    try {
      await mkdir(lock);
      break;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      if (tries >= LOCK_TRIES) throw new Error(`answers lock stuck >5s: ${lock}`, { cause: error });
      await sleep(LOCK_POLL_MS);
    }
  }
  try {
    await writeFile(path.join(lock, "pid"), String(process.pid));
    const names = (await readdir(dir)).filter((name) => name.startsWith("cursor."));
    const [log, rotated, cursors] = await Promise.all([
      readOptional(path.join(dir, "log")),
      readOptional(path.join(dir, "log.1")),
      Promise.all(names.map(async (name) => [name, await readFile(path.join(dir, name))] as const)),
    ]);
    return { log, rotated, cursors: new Map(cursors) };
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

export async function listAnswers({
  cwds,
}: RpcInput<typeof answersListRpc>): Promise<RpcOutput<typeof answersListRpc>> {
  const dir = path.join(homedir(), ".config", ".answers");
  await mkdir(dir, { recursive: true });
  const snapshot = await readSnapshot(dir);
  const { log, rotated } = snapshot;
  const all = [
    ...(rotated ? parseRows(rotated, 0) : []),
    ...(log ? parseRows(log, rotated?.length ?? 0) : []),
  ];
  const targets = cwds
    ? await Promise.all(
        [...new Set(cwds)].map(async (cwd) => ({ cwd, key: await canonicalCwd(cwd) })),
      )
    : [...new Set(all.map((row) => row.key))].map((key) => ({ cwd: key, key }));
  const entries = await Promise.all(
    targets.map(
      async ({ cwd, key }): Promise<AnswersForCwd> => ({
        cwd,
        key,
        unread: unreadRows(key, snapshot),
        recent: all
          .filter((row) => row.key === key)
          .slice(-RECENT_LIMIT)
          .map(({ key: _key, ...row }) => row),
      }),
    ),
  );
  return { cwds: entries };
}

export async function markAnswersRead({
  cwd,
}: RpcInput<typeof answersMarkReadRpc>): Promise<RpcOutput<typeof answersMarkReadRpc>> {
  try {
    await run("answers", ["clear"], { cwd, env: { ...process.env, PWD: cwd } });
  } catch (error) {
    const stderr =
      error instanceof Error && "stderr" in error && typeof error.stderr === "string"
        ? error.stderr.trim()
        : "";
    throw new Error(stderr || (error instanceof Error ? error.message : String(error)), {
      cause: error,
    });
  }
  return {};
}
