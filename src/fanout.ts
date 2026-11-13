// fanout — fan a single prompt out across several herdr-managed Claude Code
// agents (one per model tier) in parallel, then render a comparison.

import { parseArgs } from "node:util";
import { DEFAULT_TIER_KEYS, resolveTiers, type Tier } from "./tiers";
import { closePane, herdr, runAgent, type AgentResult } from "./herdr";
import { buildReport, formatJson, formatTable } from "./render";

const USAGE =
  'Usage: bun run src/fanout.ts "<prompt>" [--tiers low,medium,high] [--json] [--timeout <ms>] [--keep] [--cwd <path>]';

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    tiers: { type: "string", default: DEFAULT_TIER_KEYS.join(",") },
    json: { type: "boolean", default: false },
    timeout: { type: "string", default: "120000" },
    keep: { type: "boolean", default: false },
    cwd: { type: "string", default: process.cwd() },
    help: { type: "boolean", default: false },
  },
  allowPositionals: true,
});

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

// Prompt from the first positional, else stdin (so it can be piped in).
let prompt = positionals[0] ?? "";
if (!prompt.trim() && !process.stdin.isTTY) prompt = (await Bun.stdin.text()).trim();
if (!prompt.trim()) {
  console.error(USAGE);
  process.exit(2);
}

const timeoutMs = Number(values.timeout);
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  console.error(`Invalid --timeout: ${values.timeout}`);
  process.exit(2);
}

let tiers: Tier[];
try {
  tiers = resolveTiers(values.tiers.split(",").map((k) => k.trim()).filter(Boolean));
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
}
if (tiers.length === 0) {
  console.error(USAGE);
  process.exit(2);
}

// Fail fast if no herdr server is reachable.
try {
  await herdr(["agent", "list"]);
} catch {
  console.error("Cannot reach the herdr server — is a session running? Check `herdr status`.");
  process.exit(1);
}

const spawnedAt = new Date().toISOString();
const t0 = performance.now();

// The core of the demo: every tier drives its own agent concurrently, so
// wall-clock ≈ the slowest agent. One agent failing never aborts the others.
const settled = await Promise.allSettled(
  tiers.map((tier) => runAgent(tier, `fanout-${tier.key}`, prompt, values.cwd, timeoutMs)),
);
const results: AgentResult[] = settled.map((s, i) =>
  s.status === "fulfilled"
    ? s.value
    : {
        tier: tiers[i]!.key,
        model: tiers[i]!.model,
        status: "error",
        output: "",
        latencyMs: 0,
        error: s.reason instanceof Error ? s.reason.message : String(s.reason),
      },
);
const wallClockMs = performance.now() - t0;

if (!values.keep) {
  await Promise.allSettled(results.filter((r) => r.paneId).map((r) => closePane(r.paneId!)));
}

const report = buildReport(prompt, results, wallClockMs, spawnedAt);
console.log(values.json ? formatJson(report) : formatTable(report));
process.exit(results.every((r) => r.status === "ok") ? 0 : 1);
