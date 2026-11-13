# herdr-factory

`fanout` — a small Bun CLI that demonstrates the multi-agent capabilities of the
[herdr](https://herdr.dev) terminal multiplexer. Given a single prompt, it spawns several
Claude Code agents **in parallel** (one herdr pane per model tier: Haiku → Sonnet → Opus),
waits for them all to finish, and prints a side-by-side comparison of output and latency.

See [`spec.md`](./spec.md) for the full design.

## Prerequisites

- [Bun](https://bun.com) v1.3+
- [Claude Code](https://claude.com/claude-code) (`claude`) installed and authenticated —
  each spawned agent is a real Claude Code session
- **herdr installed with a running session** — the CLI talks to herdr over its socket, so
  a herdr server must be up before you run anything:

  ```bash
  herdr status   # should respond; if not, start/attach a herdr session first
  ```

## Install

```bash
bun install
```

## Running it in herdr

With a herdr session running, fan a prompt out to the default tiers (`low`, `medium`, `high`):

```bash
bun run src/fanout.ts "Summarize the plot of Hamlet in one sentence."
```

Each tier starts its own agent pane inside herdr (`herdr agent start fanout-<tier> -- claude --model <m>`),
sends the prompt, waits for the agent to go idle, reads the output, and closes the pane.

More examples:

```bash
# Only compare the cheapest vs the smartest model
bun run src/fanout.ts "Prove there are infinitely many primes." --tiers low,high

# Pipe a prompt in and get machine-readable output
echo "Refactor this loop into a map" | bun run src/fanout.ts --json

# Keep the spawned panes open to inspect the live agents in the herdr TUI
bun run src/fanout.ts "say hi" --tiers low --keep
```

Flags:

| Flag           | Default           | Meaning                                                          |
| -------------- | ----------------- | ---------------------------------------------------------------- |
| *(positional)* | — (else stdin)    | The prompt to fan out to every agent.                            |
| `--tiers`      | `low,medium,high` | Comma-separated tier keys to spawn (see `src/tiers.ts`).         |
| `--json`       | off               | Emit the raw report as JSON instead of the table.                |
| `--timeout`    | `120000`          | Per-agent wait timeout in ms; a stuck agent is marked `timeout`. |
| `--keep`       | off               | Leave spawned panes open instead of closing them.                |
| `--cwd`        | current dir       | Working directory passed to each spawned agent.                  |

> **Note:** a live run spawns real Claude Code sessions, so it incurs (small) API usage.
> For a cheap smoke test use `--tiers low` with a trivial prompt.

## Tests

Fixture-driven tests run without a herdr server or any API spend (`HERDR_CMD` points at a
stub that echoes canned herdr JSON envelopes):

```bash
bun test
```

## Web scaffold

The repo also contains the original Bun + React + Tailwind scaffold (unused by `fanout`):

```bash
bun dev    # development server with hot reload
bun start  # production server
```
