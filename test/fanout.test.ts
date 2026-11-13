// End-to-end CLI tests against the stub herdr — no server, no API spend.
import { expect, test } from "bun:test";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const STUB = join(import.meta.dir, "herdr-stub.ts");

async function runFanout(args: string[], env: Record<string, string> = {}) {
  const proc = Bun.spawn(["bun", "src/fanout.ts", ...args], {
    cwd: ROOT,
    env: { ...process.env, HERDR_CMD: STUB, ...env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

test("renders a comparison table and exits 0 when all agents succeed", async () => {
  const { stdout, exitCode } = await runFanout(["say hi", "--tiers", "low"]);
  expect(exitCode).toBe(0);
  expect(stdout).toContain("1 spawned · 1 ok");
  expect(stdout).toMatch(/TIER\s+MODEL\s+STATUS\s+LATENCY\s+OUTPUT/);
  expect(stdout).toContain("stub output from claude");
});

test("--json emits the full FanoutReport", async () => {
  const { stdout, exitCode } = await runFanout(["say hi", "--tiers", "low,high", "--json"]);
  expect(exitCode).toBe(0);
  const report = JSON.parse(stdout);
  expect(report.prompt).toBe("say hi");
  expect(report.results).toHaveLength(2);
  expect(report.results.map((r: any) => r.tier)).toEqual(["low", "high"]);
  expect(report.results.every((r: any) => r.status === "ok")).toBe(true);
  expect(report.wallClockMs).toBeGreaterThan(0);
});

test("empty prompt exits non-zero with usage help", async () => {
  const { stderr, exitCode } = await runFanout([]);
  expect(exitCode).toBe(2);
  expect(stderr).toContain("Usage:");
});

test("unknown tier exits non-zero with the known tiers", async () => {
  const { stderr, exitCode } = await runFanout(["say hi", "--tiers", "ultra"]);
  expect(exitCode).toBe(2);
  expect(stderr).toContain('Unknown tier "ultra"');
});

test("a failed agent still renders and flips the exit code", async () => {
  const { stdout, exitCode } = await runFanout(["say hi", "--tiers", "low", "--json"], {
    HERDR_STUB_MODE: "wait-blocked",
  });
  expect(exitCode).toBe(1);
  const report = JSON.parse(stdout);
  expect(report.results[0].status).toBe("blocked");
});

test("prompt can be piped in via stdin", async () => {
  const proc = Bun.spawn(["bun", "src/fanout.ts", "--tiers", "low", "--json"], {
    cwd: ROOT,
    env: { ...process.env, HERDR_CMD: STUB },
    stdin: new Response("piped prompt\n").body!,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  expect(exitCode).toBe(0);
  expect(JSON.parse(stdout).prompt).toBe("piped prompt");
});
