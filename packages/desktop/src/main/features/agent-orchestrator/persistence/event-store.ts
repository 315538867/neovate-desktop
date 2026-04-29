import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { PipelineEvent } from "../../../../shared/features/agent-orchestrator/schemas";

export class EventStore {
  private baseDir: string;
  private seqCounters = new Map<string, number>();

  constructor(appDataDir: string) {
    this.baseDir = path.join(appDataDir, "orchestrator", "events");
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true });
    }
  }

  getFilePath(runId: string): string {
    // sanitize runId to prevent path traversal
    const safe = runId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(this.baseDir, `${safe}.jsonl`);
  }

  append(runId: string, event: PipelineEvent): void {
    const seq = (this.seqCounters.get(runId) ?? 0) + 1;
    this.seqCounters.set(runId, seq);
    const line = JSON.stringify({ seq, ...event }) + "\n";
    appendFileSync(this.getFilePath(runId), line, "utf-8");
  }

  async *tail(runId: string, sinceSeq = 0): AsyncIterable<PipelineEvent & { seq: number }> {
    const filePath = this.getFilePath(runId);
    if (!existsSync(filePath)) return;

    // replay existing events
    const existing = readFileSync(filePath, "utf-8");
    const lines = existing.split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as PipelineEvent & { seq: number };
        if (parsed.seq > sinceSeq) {
          yield parsed;
        }
      } catch {
        // skip malformed lines
      }
    }

    // watch for new events (poll-based, every 500ms)
    let lastSeq =
      lines.length > 0 ? (JSON.parse(lines[lines.length - 1]) as { seq: number }).seq : sinceSeq;

    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (!existsSync(filePath)) break;

      const content = readFileSync(filePath, "utf-8");
      const newLines = content.split("\n").filter(Boolean);
      for (const line of newLines) {
        try {
          const parsed = JSON.parse(line) as PipelineEvent & { seq: number };
          if (parsed.seq > lastSeq) {
            lastSeq = parsed.seq;
            yield parsed;
          }
        } catch {
          // skip
        }
      }
    }
  }
}
