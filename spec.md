# Spec: `fanout` — a herdr multi-agent demo

## 1. Overview & goal

`fanout` is a small command-line tool whose **only purpose is to demonstrate the
multi-agent capabilities of the `herdr` multiplexer**. Given a single prompt, it uses
herdr to spawn several agents **at the same time**, each running a different model — from
low-cognition **Haiku** (fast, cheap, for simple tasks) up to high-cognition **Opus**
(slower, more capable, for hard reasoning) — waits for them all to finish, and prints a
**side-by-side comparison** of what each agent produced and how long it took.

The tool exists to make one thing visible: *herdr can fan a single task out across many
agents on different models concurrently.*

**Non-goals.** The usefulness or polish of the "app" is explicitly not the point. There
is no product domain, no persistence, and no web UI. This is a demonstration harness.

### How herdr actually works (grounding for this spec)

herdr is a **terminal workspace manager for AI coding agents**. It does *not* proxy the
model API and it does *not* take a model flag. Instead it launches an agent CLI (here,
Claude Code — `claude`) inside a managed terminal pane and lets you drive it over its
socket API. The important consequences:

- **The model is selected in the agent's own argv**, e.g. `claude --model opus`. herdr
  just runs whatever command comes after `--`. "Spawning agents with different models" =
  starting each pane with a different `--model` argument.
- **Every `herdr` CLI command prints a JSON envelope on stdout** of the form
  `{"id":"cli:agent:list","result":{…}}` (or `{"error":{"code":…,"message":…}}`), which
  makes it script-friendly.
- **herdr does not surface token counts or cost.** Those aren't available from the
  multiplexer, so the demo compares *output* and *latency*, not price. (See §6.)

## 2. Model tiers

Agents are organized into **cognition tiers**. Each tier maps a difficulty level to the
`--model` value passed to the underlying `claude` agent. Tiers are **config-driven** (see
`src/tiers.ts`) so the user can add, remove, or re-map models without touching the rest
of the code.

| Tier     | `claude --model`            | Full model id                | Intended use                                  |
| -------- | --------------------------- | ---------------------------- | --------------------------------------------- |
| `low`    | `haiku`                     | `claude-haiku-4-5-20251001`  | Simple, mechanical, high-volume tasks. Fastest. |
| `medium` | `sonnet`                    | `claude-sonnet-4-6`          | Balanced everyday reasoning.                  |
| `high`   | `opus`                      | `claude-opus-4-8`            | Hard reasoning, planning, ambiguous problems. |
| `creative` *(optional)* | `claude-fable-5` | `claude-fable-5`          | Creative / narrative generation.              |

Claude Code accepts either the short alias (`haiku`/`sonnet`/`opus`) or the full id; the
config stores whichever the user prefers. By default `fanout` spawns `low`, `medium`, and
`high`. The set is overridable with `--tiers` (§5).

## 3. How it works

```
                     ┌──────────────────────────────────────────────────┐
   prompt ─────────▶ │  fanout (Bun CLI)                                 │
   (arg or stdin)    │                                                   │
                     │  1. parse args + read prompt                      │
                     │  2. load enabled tiers from config                │
                     │  3. for each tier, IN PARALLEL (Promise.allSettled):
                     │       a. herdr agent start  fanout-<tier> -- claude --model <m>
                     │       b. herdr agent send   fanout-<tier> "<prompt>"
                     │       c. herdr agent wait   fanout-<tier> --status idle
                     │       d. herdr agent read   fanout-<tier> --source recent
                     │  4. collect each AgentResult                      │
                     │  5. aggregate into FanoutReport                   │
                     │  6. render comparison table (or JSON)             │
                     │  7. (optional) clean up the spawned panes         │
                     └──────────────────────────────────────────────────┘
```

1. **Read the prompt** from the first positional argument, or from stdin if none is given
   (so it can be piped: `echo "..." | bun run src/fanout.ts`).
2. **Load the enabled tiers** from `src/tiers.ts`, filtered by `--tiers` if provided.
3. **For each tier, run the start→send→wait→read sequence in parallel.** This is the core
   of the demo: a single `Promise.allSettled` over the tiers. Each tier drives its own
   herdr agent concurrently, so wall-clock ≈ the slowest agent, not the sum. We time each
   agent ourselves (`performance.now()` around send→idle) since herdr gives status, not
   latency.
4. **Collect** each agent's read output and terminal status into a typed `AgentResult`.
5. **Aggregate** into a `FanoutReport` (pure function, easily testable).
6. **Render** as a terminal comparison table, or as raw JSON with `--json`.
7. **Optionally clean up** the spawned panes (§9) unless `--keep` is passed.

## 4. herdr CLI contract

This section reflects the **real** `herdr agent`/`herdr pane` interface (verified via
`--help` and live runs). Note two envelope behaviors, confirmed empirically:
- Query/lifecycle commands (`list`, `start`, `pane split`, `pane read`, `pane close`)
  print a JSON envelope on stdout: `{"id":...,"result":{...}}` or `{"error":{...}}`.
- **Input commands (`send`, `pane send-text`, `pane send-keys`) print nothing on
  success** — check the process exit code (0), not stdout, for those.

`targets` accept the agent name we assign at start; `pane_id` comes from the start result.

| Step   | Command                                                                                 | Purpose |
| ------ | --------------------------------------------------------------------------------------- | ------- |
| start  | `herdr agent start <name> --cwd <path> --split down --no-focus -- claude --model <m>`    | Launch an agent pane running `claude` on model `<m>`. Result carries the `pane_id`. |
| send   | `herdr agent send <name> "<prompt>"`                                                     | Type the prompt into the agent (literal text, **no submit**). |
| submit | `herdr pane send-keys <pane_id> enter`                                                    | Press Enter to submit the typed prompt (see note below). |
| wait   | `herdr agent wait <name> --status idle --timeout <ms>`                                   | Block until the agent finishes (status `idle`). |
| read   | `herdr agent read <name> --source recent --format text [--lines N]`                      | Capture the agent's output. |
| list   | `herdr agent list`                                                                       | Enumerate agents (used for cleanup / discovery). |
| clean  | `herdr pane close <pane_id>`                                                              | Close the spawned pane after the run (returns `{"result":{"type":"ok"}}`). |

**`herdr agent list` result shape** (real sample):

```json
{"id":"cli:agent:list","result":{"type":"agent_list","agents":[
  {"agent":"claude","agent_status":"idle","cwd":"/Users/.../agent-test",
   "pane_id":"w3:pJ","tab_id":"w3:t9","terminal_id":"term_65630193cba2b11",
   "workspace_id":"w3","focused":true,"revision":0}
]}}
```

- `agent_status` is one of `idle | working | blocked | unknown`. `wait --status idle`
  is how we know an agent has completed its turn.
- **Submit is confirmed (nailed down via a live shell-pane test):** `agent send` only
  *types* text; it does not press Enter. Follow it with `herdr pane send-keys <pane_id>
  enter` to submit. The key token is the lowercase word `enter` — herdr's key syntax uses
  plain special-key names (`enter`, `tab`, `esc`, arrows) with `ctrl+`/`shift+`/`alt+`
  modifiers. `send-keys` accepts multiple keys: `send-keys <pane_id> enter`.
- **Reading output:** `--source recent` returns the *agent's* recent output (right for a
  real `claude` agent); `--source visible` returns the raw visible screen (handy for
  non-agent panes and for the stub test in §10).

All herdr I/O is isolated in **`src/herdr.ts`**, e.g.:

```ts
// src/herdr.ts
const HERDR = process.env.HERDR_CMD ?? "herdr";

// Query/lifecycle commands: parse the JSON envelope, throw on error.
async function herdr(args: string[]): Promise<any> {
  const proc = Bun.spawn([HERDR, ...args], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  const env = JSON.parse(out);
  if (env.error) throw new Error(`${env.error.code}: ${env.error.message}`);
  return env.result;
}

// Input commands (send/send-text/send-keys): no stdout on success — check exit code.
async function herdrInput(args: string[]): Promise<void> {
  const proc = Bun.spawn([HERDR, ...args], { stdout: "pipe", stderr: "pipe" });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`herdr ${args[0]} ${args[1]} exited ${code}`);
}

export async function runAgent(tier: Tier, name: string, prompt: string, cwd: string,
                               timeoutMs: number): Promise<AgentResult> {
  const started = performance.now();
  const start = await herdr(["agent", "start", name, "--cwd", cwd, "--split", "down",
                             "--no-focus", "--", "claude", "--model", tier.model]);
  const paneId = start.pane.pane_id;                        // e.g. "w3:pJ"
  await herdrInput(["agent", "send", name, prompt]);        // types the prompt
  await herdrInput(["pane", "send-keys", paneId, "enter"]); // submits it (confirmed)
  await herdr(["agent", "wait", name, "--status", "idle", "--timeout", String(timeoutMs)]);
  const read = await herdr(["agent", "read", name, "--source", "recent", "--format", "text"]);
  return { tier: tier.key, model: tier.model, status: "ok", paneId,
           output: read.text ?? "", latencyMs: performance.now() - started };
}

// cleanup: await herdr(["pane", "close", paneId]);  // -> { type: "ok" }
```

- **`HERDR_CMD`** env var overrides the binary/path (used for the fixture-driven tests in
  §10).
- herdr must have a running session/server (`herdr status`); the CLI talks to it over the
  socket. `fanout` does not need to be attached to the TUI.

## 5. CLI usage

```
bun run src/fanout.ts "<prompt>" [--tiers low,medium,high] [--json] [--timeout <ms>] [--keep] [--cwd <path>]
```

| Flag           | Default              | Meaning                                                       |
| -------------- | -------------------- | ------------------------------------------------------------- |
| *(positional)* | — (else stdin)       | The prompt to fan out to every agent.                         |
| `--tiers`      | `low,medium,high`    | Comma-separated tier keys to spawn.                           |
| `--json`       | off                  | Emit the raw `FanoutReport` as JSON instead of the table.     |
| `--timeout`    | `120000`             | Per-agent wait timeout in ms; a stuck agent is marked `timeout`. |
| `--keep`       | off                  | Leave spawned panes open instead of closing them (§9).        |
| `--cwd`        | current dir          | Working directory passed to each spawned agent.               |

Examples:

```bash
# Fan out to the three default tiers
bun run src/fanout.ts "Summarize the plot of Hamlet in one sentence."

# Only compare the cheapest vs the smartest
bun run src/fanout.ts "Prove there are infinitely many primes." --tiers low,high

# Pipe a prompt in and get machine-readable output
echo "Refactor this loop into a map" | bun run src/fanout.ts --json
```

## 6. Output format

**Default: a pretty terminal table**, one row per agent. Because herdr does not report
tokens or cost, the comparison is **output + latency + status**:

```
Prompt: "Summarize the plot of Hamlet in one sentence."
Agents: 3 spawned · 3 ok · wall-clock 6.4s

TIER    MODEL                 STATUS   LATENCY   OUTPUT
low     haiku                 ok         2.1s    "A Danish prince avenges his father's murder…"
medium  sonnet                ok         4.0s    "Prince Hamlet, urged by his father's ghost, feigns…"
high    opus                  ok         6.4s    "Hamlet, prince of Denmark, is charged by his father's…"
```

- **`LATENCY`** is measured by `fanout` (time from `send` to `idle`), not by herdr.
- **`OUTPUT`** is a single-line truncated preview; full per-agent outputs are printed
  below the table (and included in `--json`).
- **No cost/token columns** — not available from herdr. (Called out here so the omission
  is intentional, not an oversight.)

**`--json` mode** prints the full `FanoutReport` object (§8).

## 7. Architecture / files

Bun-native only — **no extra dependencies** (`Bun.spawn`, `Response`, `performance.now()`,
built-in arg parsing), per `CLAUDE.md`. The existing React/Tailwind scaffold is untouched.

```
src/
  fanout.ts    # entry point: arg parsing, orchestration, exit code, cleanup
  herdr.ts     # the ONLY herdr-aware code: herdr() envelope helper + runAgent() (§4)
  tiers.ts     # tier → model config
  render.ts    # pure functions: buildReport(), formatTable(), formatJson()
```

Keeping herdr I/O in `herdr.ts` and rendering as pure functions in `render.ts` means the
aggregation/formatting logic is unit-testable without any subprocess (§10).

## 8. Data shapes

```ts
// src/tiers.ts
export interface Tier {
  key: string;    // "low" | "medium" | "high" | ...
  model: string;  // value passed to `claude --model` (alias or full id)
}

// src/herdr.ts
export interface AgentResult {
  tier: string;
  model: string;
  status: "ok" | "error" | "timeout" | "blocked";
  output: string;
  latencyMs: number;
  paneId?: string;     // captured from start, used for cleanup
  error?: string;      // populated when status !== "ok"
}

// src/render.ts
export interface FanoutReport {
  prompt: string;
  spawnedAt: string;   // ISO timestamp
  wallClockMs: number; // total elapsed for the whole fan-out
  results: AgentResult[];
}
```

## 9. Error & edge handling

- **Isolation:** one agent failing must **never** abort the others. Use
  `Promise.allSettled` so a crashed/blocked/timed-out agent becomes an `AgentResult` with
  a non-`ok` status and the run still completes and renders.
- **`blocked` status:** if `agent_status` becomes `blocked` (agent waiting on a
  permission prompt), `wait` won't reach `idle`; treat the timeout as `status: "blocked"`
  and note it in the table rather than hanging.
- **Per-agent timeout:** `--timeout` bounds the `wait`; on expiry mark `timeout` and move
  on.
- **No running herdr server:** if `herdr agent list` errors (socket unavailable), exit
  early telling the user to start herdr (`herdr status`).
- **herdr error envelopes:** any `{"error":…}` from a command → that agent's result is
  `status: "error"` with the `code: message` captured in `error`.
- **Cleanup:** by default, close each spawned pane after reading with
  `herdr pane close <pane_id>` (confirmed; returns `{"result":{"type":"ok"}}`) so repeated
  demo runs don't pile up panes. `--keep` skips cleanup so the user can inspect the live
  agents in the herdr TUI.
- **Partial results always render;** process exit code is non-zero if any agent failed.
- **Empty prompt:** exit early with usage help.

## 10. Verification

herdr agents are real Claude Code sessions, so there is unavoidable (small) API usage for
a live run. Split verification into no-cost and low-cost layers:

- **No API spend — fixture/stub tests (`bun test`):**
  - Point `HERDR_CMD` at a stub script that echoes canned herdr JSON envelopes (real
    samples are captured in §4), so `herdr.ts`'s envelope parsing, `.error` handling, and
    the start→send→wait→read sequencing can be exercised without a real server.
  - Unit-test the pure functions in `render.ts` — `buildReport()` aggregation and
    table/JSON formatting — against fixture `AgentResult[]`.
- **No API spend — read-only smoke against live herdr:** run a variant that only calls
  `herdr agent list` / `read` on *already-idle* agents to confirm the adapter talks to
  the real socket and parses live output.
- **Low-cost live run:** `bun run src/fanout.ts "say hi" --tiers low` spawns a single
  Haiku agent end-to-end (cheapest model, trivial prompt). Confirm a pane appears, the
  prompt is submitted, `wait` returns on `idle`, output is captured, and the pane is
  cleaned up. Then scale to `--tiers low,medium,high` and confirm wall-clock ≈ the slowest
  agent (proving the spawns really ran in parallel).

## 11. Future extensions (out of scope)

- **Orchestrator + worker mode:** an Opus "lead" agent plans and decomposes a goal, then
  spawns cheap Haiku worker agents (each its own herdr pane) for sub-tasks and synthesizes
  — showing hierarchy, not just fan-out.
- **Difficulty-based routing:** classify the incoming task first, then start a *single*
  appropriately-tiered agent instead of fanning out to all.
- **Web dashboard:** reuse the idle React/Tailwind scaffold to poll `herdr agent list` and
  show the spawned agents, their live status, and streamed output in real time.
- **Workspace isolation:** start each agent in its own git worktree (`herdr worktree`) so
  code-editing tasks don't collide.
```
