import { expect, test } from "bun:test";
import type { AgentResult } from "../src/herdr";
import { buildReport, formatJson, formatTable, preview } from "../src/render";

const RESULTS: AgentResult[] = [
  {
    tier: "low",
    model: "haiku",
    status: "ok",
    output: "A Danish prince avenges his father's murder.",
    latencyMs: 2100,
    paneId: "w3:p1",
  },
  {
    tier: "medium",
    model: "sonnet",
    status: "ok",
    output: `Prince Hamlet, urged by his father's ghost,\nfeigns madness ${"x".repeat(100)}`,
    latencyMs: 4000,
    paneId: "w3:p2",
  },
  {
    tier: "high",
    model: "opus",
    status: "timeout",
    output: "",
    latencyMs: 120000,
    paneId: "w3:p3",
    error: "timeout: agent did not reach status idle in time",
  },
];

const REPORT = buildReport("Summarize Hamlet.", RESULTS, 6400, "2026-11-13T00:00:00.000Z");

test("buildReport assembles the FanoutReport shape", () => {
  expect(REPORT).toEqual({
    prompt: "Summarize Hamlet.",
    spawnedAt: "2026-11-13T00:00:00.000Z",
    wallClockMs: 6400,
    results: RESULTS,
  });
});

test("preview collapses whitespace and truncates with an ellipsis", () => {
  expect(preview("a  b\n\nc")).toBe("a b c");
  const long = preview("word ".repeat(40));
  expect(long.length).toBe(60);
  expect(long.endsWith("…")).toBe(true);
});

test("formatTable renders summary, one row per agent, and full outputs", () => {
  const table = formatTable(REPORT);
  expect(table).toContain('Prompt: "Summarize Hamlet."');
  expect(table).toContain("3 spawned · 2 ok · wall-clock 6.4s");
  expect(table).toContain("TIER");
  expect(table).toMatch(/low\s+haiku\s+ok\s+2\.1s/);
  // Non-ok rows surface the error instead of an output preview.
  expect(table).toMatch(/high\s+opus\s+timeout\s+120\.0s\s+timeout:/);
  // Multi-line output is one truncated line in the table...
  expect(table).toContain('"Prince Hamlet, urged by his father\'s ghost, feigns madness');
  // ...and printed in full below it.
  expect(table).toContain("── medium (sonnet) ──");
  expect(table).toContain("feigns madness");
  // No cost/token columns — not available from herdr.
  expect(table).not.toContain("COST");
  expect(table).not.toContain("TOKENS");
});

test("formatJson round-trips the report", () => {
  expect(JSON.parse(formatJson(REPORT))).toEqual(JSON.parse(JSON.stringify(REPORT)));
});
