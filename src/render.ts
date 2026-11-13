// Pure functions: report aggregation and rendering. No herdr, no subprocesses.

import type { AgentResult } from "./herdr";

export interface FanoutReport {
  prompt: string;
  spawnedAt: string; // ISO timestamp
  wallClockMs: number; // total elapsed for the whole fan-out
  results: AgentResult[];
}

export function buildReport(
  prompt: string,
  results: AgentResult[],
  wallClockMs: number,
  spawnedAt: string,
): FanoutReport {
  return { prompt, spawnedAt, wallClockMs, results };
}

function formatLatency(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

// Single-line truncated preview for the table cell.
export function preview(text: string, max = 60): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

export function formatTable(report: FanoutReport): string {
  const ok = report.results.filter((r) => r.status === "ok").length;
  const lines: string[] = [
    `Prompt: ${JSON.stringify(report.prompt)}`,
    `Agents: ${report.results.length} spawned · ${ok} ok · wall-clock ${formatLatency(report.wallClockMs)}`,
    "",
  ];

  const header = ["TIER", "MODEL", "STATUS", "LATENCY", "OUTPUT"];
  const rows = report.results.map((r) => [
    r.tier,
    r.model,
    r.status,
    formatLatency(r.latencyMs),
    r.status === "ok" ? `"${preview(r.output)}"` : (r.error ?? ""),
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i]!.length)));
  const renderRow = (cells: string[]) =>
    cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i]!))).join("   ").trimEnd();
  lines.push(renderRow(header));
  for (const row of rows) lines.push(renderRow(row));

  // Full per-agent outputs below the table.
  for (const r of report.results) {
    if (r.status === "ok" && r.output.trim()) {
      lines.push("", `── ${r.tier} (${r.model}) ──`, r.output.trim());
    }
  }
  return lines.join("\n");
}

export function formatJson(report: FanoutReport): string {
  return JSON.stringify(report, null, 2);
}
