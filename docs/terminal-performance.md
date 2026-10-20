# Terminal performance

How terminal output stays low-latency, what the invariants are, and how to measure before/after any change to the pipeline. Read this before touching anything under `packages/server/src/terminal/` or `packages/app/src/terminal/runtime/`.

## The pipeline

```
pty (node-pty, forked worker process)
  → headless xterm parse (worker, snapshot fidelity)
  → TerminalOutputCoalescer (worker, ≤1 IPC message per 5ms per terminal)
  → process.send IPC → daemon main process
  → TerminalOutputCoalescer (per client stream, terminal-session-controller.ts)
  → binary ws frame (2-byte header + raw bytes)
  → client decode (daemon-client.ts) → stream router → emulator runtime
  → xterm.write (back-to-back; xterm batches internally)
```

Terminal frames share the daemon main event loop with all agent traffic. The `eventLoopDelay` block in the `ws_runtime_metrics` log line (every 30s in `daemon.log`) is the ground truth for "the daemon is busy" — p99/max there directly bound worst-case terminal frame delay.

## Invariants (the easy-to-break ones)

- **Coalescers are leading+trailing throttles.** The first chunk after an idle window flushes immediately (synchronously); only sustained bursts wait for the trailing timer. Reverting to trailing-only adds a full window (~5ms) to every keystroke echo.
- **Output coalescing happens in the worker, before IPC.** One `process.send` per pty chunk was a main-loop flood under build output. Non-output messages (snapshot/snapshotReady/titleChange/exit) must flush the coalescer first so ordering is preserved.
- **Coalesced output carries the LAST chunk's revision.** Snapshot replay dedup (`replayTerminalOutputAfterSnapshot`) skips buffered output with `revision <= replayRevision`; a merged batch with a lower revision would be wrongly skipped (lost output).
- **The input-mode tracker runs once per process boundary, not per hop.** The worker owns the authoritative tracker; the daemon caches the replay preamble from `getTerminalState` responses and `snapshotReady` messages. Do not reintroduce a per-chunk `feed()` on the daemon main loop.
- **Snapshot catch-up is backpressure-gated.** A stream falls back to a full snapshot only when `outputBytesSinceSnapshot > MAX_TERMINAL_OUTPUT_FRAME_BYTES` (256KB) **and** the client transport reports `bufferedAmount > MAX_CLIENT_BUFFERED_BYTES` (4MB). A client that keeps draining streams continuously, no matter how much output is produced. Before this gate existed, every 256KB of build output dropped a frame and forced a full JSON cell-grid snapshot (~200k objects across IPC) — the historical source of spiky lag and GC hitches.
- **Plugin daemon sessions report IPC queue bytes.** Their virtual socket increments `bufferedAmount` before `process.send` and decrements it only in the send callback. Text and binary frames share that ordered queue, so the normal snapshot catch-up and physical high-water gates remain valid for server-side plugin SDK traffic.
- **Client output writes are not serialized per frame.** The emulator runtime drains contiguous plain writes straight into xterm (which buffers internally). Only barrier ops (`clear`, `snapshot`, `suppressInput` writes) wait — behind a zero-length sentinel write — so resets can't interleave with in-flight output.
- **Find preserves the inspected xterm viewport, including at the live bottom.** Keep its output anchor inside the existing batched write path. Serializing output to preserve a search result would add terminal latency.
- **Retained terminal tabs in the focused workspace keep their streams.** Hidden mounted terminals continue applying output, so switching tabs does not resubscribe or request a fresh snapshot. The retained-panel LRU bounds the number of live streams; terminals in an unfocused workspace detach.
- **Terminal size has one daemon-owned claimant.** Focus and direct interaction send a `claim`; later geometry changes from that connection send `update`. A claim transfers ownership even when the dimensions are unchanged, while an update from any other connection is ignored. This lets an owning pane follow splits and keyboard insets without allowing an idle phone or browser to steal the PTY size.
- **PR Cockpit shortcuts come from pane content, not repository PR status.** Plain `prcockpit://pr/<owner>/<repo>/<number>` text and OSC8 targets feed a bounded incremental scanner; never rescan the terminal buffer on output. Explicit hyperlink targets must match verbatim; punctuation cleanup applies only to prose. Legacy cell-grid snapshots have no OSC8 metadata, so only their visible URL text can be recovered. A cursor at the logical content end leaves its token unfinished across padding and soft wraps; a cursor inside existing content must not split visible URLs. Raw terminal restores retain both unfinished parser state and hyperlink targets. Agent panes reuse completed timeline results and consume appended text from the latest assistant/thought by stable item ID; non-prefix replacements reset that scanner. Links and parser state stay local to the mounted pane, unchanged link sets retain their array references, and opening a shortcut uses the external URL opener. There is no PR fetch or link persistence.

## Measuring

- **Node-only benchmark (fast iteration, server pipeline):** `npx tsx scripts/benchmark-terminal-latency.ts`. Boots an isolated daemon (fresh `PASEO_HOME`, random port — never 6767), measures echo latency percentiles, burst jitter, and snapshot counts under ramped mock-agent load. Writes JSON to `/tmp/paseo-terminal-bench/`. Healthy numbers (2026-06): echo p50 ~2.3ms, p95 ~3.3ms, a 2MB burst fully streamed with `snap=0`.
- **Browser perf specs (user-perceived path):** gated behind `PASEO_TERMINAL_PERF_E2E=1` —
  `packages/app/e2e/browser/terminal-performance.spec.ts` and `packages/app/e2e/browser/terminal-keystroke-stress.spec.ts` (per-stage keydown→xterm-commit breakdown under mock-agent load). Healthy: keydown→commit p50 ~18ms under 600-key burst.
- **Production:** grep `daemon.log` for `ws_runtime_metrics` and read `eventLoopDelay` + `bufferedAmount`.
- **Git pressure:** the same log line includes `git.commands` (limiter occupancy, queue age,
  queue wait, execution time, failures, timeouts, and top operations),
  `git.workspaceService` (daemon-global Git observer ownership), and per-session workspace Git
  subscription totals under `runtime`. Queue wait and execution time are separate because the Git
  command timeout begins only after a command acquires a limiter slot.

### Bounded PR Cockpit smoke/profile

Use synthetic content in a disposable pane, never copied private histories or a live tmux import. Do not restart the main daemon. Emit links from a disposable script rather than echoing URL-bearing shell commands, whose input text also creates shortcuts.

1. Run only `npx vitest run packages/app/src/components/pr-cockpit/links.test.ts packages/app/src/components/pr-cockpit/timeline-links.test.ts --bail=1`. These regressions cover real xterm cursor/padding/wrap snapshots followed by output, cursors inside intact visible URLs, raw restore continuation, strict OSC8 targets, immutable timeline replacements, and unchanged link references.
2. For a UI smoke, print `prcockpit://pr/example/repo/1` without a newline, restore/reconnect the disposable terminal pane, then print `23\n`. The shortcut must become only `#123`, with no stale `#1`. Repeat at a narrow terminal width. Print an OSC8 target ending in `123.` with the visible label `Review`; it must add no shortcut. Check a second pane remains unchanged.
3. Record at most ten seconds of a web/Electron Performance trace using synthetic output: seed 100 distinct complete Cockpit links, then send at most 1,000 ordinary 128-byte chunks. Repeat with 1,000 seeded links. After seeding, inspect `CockpitLinkScanner.getLinks` and subscriber stacks for historical link-array work on ordinary writes; compare allocation samples, not only total wall time.
4. For the timeline selector, use 100 fixed history items and one immutable assistant item with a stable ID, capped at 128 KiB total text over 1,000 appends. Compare with 1,000 history items. Inspect scanner work separately from history aggregation and the full-prefix check needed to reject replacements; only the newly appended suffix should enter the scanner. Include one non-prefix edit to confirm old shortcuts disappear. Do not treat stable-reference assertions as a throughput measurement.

## Known remaining contention (follow-up candidates)

- A single large `agent_stream` message (e.g. a 250KB diff payload) measurably delays terminal echo (~100ms-class dips) — cost is split between daemon serialization and app-side parse/render on the shared browser main thread. See [agent-stream-performance.md](agent-stream-performance.md) for that pipeline's own budgets.
- Relay-attached clients pay pure-JS tweetnacl encryption on the daemon main loop (`packages/relay/src/encrypted-channel.ts`). Negotiated binary application frames stay binary ciphertext and avoid base64 encode/decode; text and mixed-version traffic remain base64 WebSocket text frames.
- `sendToClient` re-stringifies session messages per socket; only matters for multi-socket connections.
