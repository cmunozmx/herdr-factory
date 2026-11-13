import { afterEach, beforeEach, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { herdr, herdrInput, runAgent } from "../src/herdr";

const STUB = join(import.meta.dir, "herdr-stub.ts");
const TIER = { key: "low", model: "haiku" };

let logPath: string;
let logSeq = 0;

beforeEach(() => {
  process.env.HERDR_CMD = STUB;
  delete process.env.HERDR_STUB_MODE;
  logPath = join(tmpdir(), `herdr-stub-${process.pid}-${++logSeq}.log`);
  process.env.HERDR_STUB_LOG = logPath;
});

afterEach(async () => {
  delete process.env.HERDR_CMD;
  delete process.env.HERDR_STUB_MODE;
  delete process.env.HERDR_STUB_LOG;
  const log = Bun.file(logPath);
  if (await log.exists()) await log.delete();
});

async function loggedCalls(): Promise<string[][]> {
  const text = await Bun.file(logPath).text();
  return text.trim().split("\n").map((line) => JSON.parse(line));
}

test("herdr() parses a result envelope", async () => {
  const result = await herdr(["agent", "list"]);
  expect(result.type).toBe("agent_list");
  expect(result.agents[0].pane_id).toBe("w3:pJ");
});

test("herdr() throws code: message on an error envelope", async () => {
  expect(herdr(["bogus", "command"])).rejects.toThrow("unknown_command: stub has no handler");
});

test("herdrInput() resolves on exit 0 and throws on non-zero", async () => {
  await herdrInput(["agent", "send", "fanout-low", "hello"]);
  process.env.HERDR_STUB_MODE = "send-fail";
  expect(herdrInput(["agent", "send", "fanout-low", "hello"])).rejects.toThrow("exited 1");
});

test("runAgent happy path: start → send → submit → wait → read, in order", async () => {
  const result = await runAgent(TIER, "fanout-low", "say hi", "/tmp", 5000);

  expect(result.status).toBe("ok");
  expect(result.tier).toBe("low");
  expect(result.model).toBe("haiku");
  expect(result.paneId).toBe("w3:pJ");
  expect(result.output).toBe("stub output from claude");
  expect(result.latencyMs).toBeGreaterThan(0);

  const calls = await loggedCalls();
  expect(calls.map((c) => c.slice(0, 2).join(" "))).toEqual([
    "agent start",
    "agent send",
    "pane send-keys",
    "agent wait",
    "agent read",
  ]);
  // The model goes into the agent's own argv after `--`.
  expect(calls[0]).toContain("--model");
  expect(calls[0]).toContain("haiku");
  // Submit is a separate Enter keypress on the pane from start's result.
  expect(calls[2]).toEqual(["pane", "send-keys", "w3:pJ", "enter"]);
});

test("runAgent marks a wait expiry as timeout when the agent is not blocked", async () => {
  process.env.HERDR_STUB_MODE = "wait-timeout";
  const result = await runAgent(TIER, "fanout-low", "say hi", "/tmp", 50);
  expect(result.status).toBe("timeout");
  expect(result.error).toContain("timeout");
  expect(result.paneId).toBe("w3:pJ");
});

test("runAgent marks a wait expiry as blocked when agent_status is blocked", async () => {
  process.env.HERDR_STUB_MODE = "wait-blocked";
  const result = await runAgent(TIER, "fanout-low", "say hi", "/tmp", 50);
  expect(result.status).toBe("blocked");
});

test("runAgent turns a failed input command into an error result, not a throw", async () => {
  process.env.HERDR_STUB_MODE = "send-fail";
  const result = await runAgent(TIER, "fanout-low", "say hi", "/tmp", 50);
  expect(result.status).toBe("error");
  expect(result.error).toContain("exited 1");
});
