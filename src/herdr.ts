// The ONLY herdr-aware code: JSON-envelope helpers plus the per-agent
// start → send → submit → wait → read sequence.

import type { Tier } from "./tiers";

export interface AgentResult {
  tier: string;
  model: string;
  status: "ok" | "error" | "timeout" | "blocked";
  output: string;
  latencyMs: number;
  paneId?: string; // captured from start, used for cleanup
  error?: string; // populated when status !== "ok"
}

// HERDR_CMD overrides the binary/path (used by the fixture-driven tests).
// Read at call time so tests can set it without import-order tricks.
function herdrCmd(): string {
  return process.env.HERDR_CMD ?? "herdr";
}

// Query/lifecycle commands (list, start, wait, read, pane close) print a JSON
// envelope on stdout: {"id":...,"result":{...}} or {"error":{...}}.
export async function herdr(args: string[]): Promise<any> {
  const proc = Bun.spawn([herdrCmd(), ...args], {
    env: { ...process.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  let envelope: any;
  try {
    envelope = JSON.parse(out);
  } catch {
    throw new Error(`herdr ${args.join(" ")}: non-JSON output: ${out.slice(0, 200)}`);
  }
  if (envelope.error) throw new Error(`${envelope.error.code}: ${envelope.error.message}`);
  return envelope.result;
}

// Input commands (send, send-text, send-keys) print nothing on success —
// check the exit code, not stdout.
export async function herdrInput(args: string[]): Promise<void> {
  const proc = Bun.spawn([herdrCmd(), ...args], {
    env: { ...process.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`herdr ${args.slice(0, 2).join(" ")} exited ${code}`);
}

async function agentStatus(name: string): Promise<string> {
  const result = await herdr(["agent", "list"]);
  const agent = result?.agents?.find((a: any) => a.agent === name || a.name === name);
  return agent?.agent_status ?? "unknown";
}

export async function closePane(paneId: string): Promise<void> {
  await herdr(["pane", "close", paneId]);
}

export async function runAgent(
  tier: Tier,
  name: string,
  prompt: string,
  cwd: string,
  timeoutMs: number,
): Promise<AgentResult> {
  const base = { tier: tier.key, model: tier.model };
  let paneId: string | undefined;
  let started = 0;
  try {
    const start = await herdr([
      "agent", "start", name,
      "--cwd", cwd,
      "--split", "down",
      "--no-focus",
      "--", "claude", "--model", tier.model,
    ]);
    paneId = start?.pane?.pane_id;

    // Latency is measured send → idle; herdr gives status, not timing.
    started = performance.now();
    await herdrInput(["agent", "send", name, prompt]); // types the prompt, no submit
    if (!paneId) throw new Error(`agent start for "${name}" returned no pane_id`);
    await herdrInput(["pane", "send-keys", paneId, "enter"]); // submits it

    try {
      await herdr(["agent", "wait", name, "--status", "idle", "--timeout", String(timeoutMs)]);
    } catch (err) {
      // wait never reached idle: a blocked agent (permission prompt) looks the
      // same as a slow one, so check the live status to tell them apart.
      const status = await agentStatus(name).catch(() => "unknown");
      return {
        ...base,
        paneId,
        status: status === "blocked" ? "blocked" : "timeout",
        output: "",
        latencyMs: performance.now() - started,
        error: err instanceof Error ? err.message : String(err),
      };
    }
    const latencyMs = performance.now() - started;

    const read = await herdr(["agent", "read", name, "--source", "recent", "--format", "text"]);
    return { ...base, paneId, status: "ok", output: read?.text ?? "", latencyMs };
  } catch (err) {
    return {
      ...base,
      paneId,
      status: "error",
      output: "",
      latencyMs: started ? performance.now() - started : 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
