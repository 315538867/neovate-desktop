import type { PipelineRun } from "../../../../shared/features/agent-orchestrator/schemas";
import type { RunStore } from "../persistence/run-store";

/**
 * HeartbeatService — 30s 心跳 + 僵尸检测。
 * 监控运行中的 PipelineRun，将超时无心跳的 run 标记为 stalled。
 */
export class HeartbeatService {
  private interval: ReturnType<typeof setInterval> | null = null;
  /** 心跳间隔 30s */
  private heartbeatIntervalMs = 30_000;
  /** 僵尸阈值：2 分钟无心跳 */
  private zombieThresholdMs = 120_000;

  constructor(private runStore: RunStore) {}

  start(): void {
    if (this.interval) return;
    this.interval = setInterval(() => this.beat(), this.heartbeatIntervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /**
   * 记录心跳到活跃 run
   */
  recordHeartbeat(run: PipelineRun): void {
    run.lastHeartbeatAt = new Date().toISOString();
    this.runStore.save(run);
  }

  /**
   * 检测僵尸 run（超时无心跳）
   */
  detectZombies(): PipelineRun[] {
    const now = Date.now();
    const zombies: PipelineRun[] = [];

    const recoverable = this.runStore.listRecoverable();
    for (const run of recoverable) {
      if (!run.lastHeartbeatAt) continue;
      const lastBeat = new Date(run.lastHeartbeatAt).getTime();
      if (now - lastBeat > this.zombieThresholdMs) {
        zombies.push(run);
      }
    }

    return zombies;
  }

  private beat(): void {
    const zombies = this.detectZombies();
    for (const run of zombies) {
      run.status = "stalled";
      this.runStore.save(run);
    }
  }
}
