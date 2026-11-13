#!/usr/bin/env bun
// Stub herdr binary for tests: echoes canned JSON envelopes (real samples from
// spec.md §4) so herdr.ts can be exercised with no server and no API spend.
//
// HERDR_STUB_MODE controls failure injection:
//   ok (default) | send-fail | wait-timeout | wait-blocked
// HERDR_STUB_LOG, when set, appends each invocation's argv as a JSON line so
// tests can assert on command sequencing.

import { appendFileSync } from "node:fs";

const args = Bun.argv.slice(2);
const mode = process.env.HERDR_STUB_MODE ?? "ok";
if (process.env.HERDR_STUB_LOG) {
  appendFileSync(process.env.HERDR_STUB_LOG, `${JSON.stringify(args)}\n`);
}

const key = args.slice(0, 2).join(" ");
const ok = (result: unknown) =>
  console.log(JSON.stringify({ id: `cli:${key.replace(" ", ":")}`, result }));
const fail = (code: string, message: string) =>
  console.log(JSON.stringify({ id: `cli:${key.replace(" ", ":")}`, error: { code, message } }));

switch (key) {
  case "agent start":
    ok({ type: "agent_started", pane: { pane_id: "w3:pJ" } });
    break;
  case "agent send":
  case "pane send-keys":
    // Input commands print nothing on success — exit code only.
    if (mode === "send-fail") process.exit(1);
    break;
  case "agent wait":
    if (mode === "wait-timeout" || mode === "wait-blocked") {
      fail("timeout", "agent did not reach status idle in time");
      break;
    }
    ok({ type: "agent_wait", status: "idle" });
    break;
  case "agent read":
    ok({ type: "agent_read", text: "stub output from claude" });
    break;
  case "agent list":
    ok({
      type: "agent_list",
      agents: [
        {
          agent: "fanout-low",
          agent_status: mode === "wait-blocked" ? "blocked" : "idle",
          cwd: "/tmp",
          pane_id: "w3:pJ",
          tab_id: "w3:t9",
          terminal_id: "term_65630193cba2b11",
          workspace_id: "w3",
          focused: false,
          revision: 0,
        },
      ],
    });
    break;
  case "pane close":
    ok({ type: "ok" });
    break;
  default:
    fail("unknown_command", `stub has no handler for: ${key}`);
}
