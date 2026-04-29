import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * SingleInstanceLock — 基于文件锁的单实例保证。
 * 防止多个进程同时操作同一 run。
 */
export class SingleInstanceLock {
  private lockDir: string;
  private locks = new Set<string>();

  constructor(appDataDir: string) {
    this.lockDir = path.join(appDataDir, "orchestrator", "locks");
  }

  /**
   * 获取锁。返回 true 表示成功获取。
   */
  acquire(runId: string, pid: number = process.pid): boolean {
    const lockFile = this.lockPath(runId);

    if (existsSync(lockFile)) {
      // 检查是否过期（stale lock from dead process）
      if (this.isStale(lockFile)) {
        this.release(runId);
      } else {
        return false;
      }
    }

    writeFileSync(lockFile, JSON.stringify({ pid, acquiredAt: new Date().toISOString() }));
    this.locks.add(runId);
    return true;
  }

  /**
   * 释放锁
   */
  release(runId: string): void {
    const lockFile = this.lockPath(runId);
    try {
      if (existsSync(lockFile)) unlinkSync(lockFile);
    } catch {
      // 忽略
    }
    this.locks.delete(runId);
  }

  /**
   * 释放所有锁
   */
  releaseAll(): void {
    for (const id of this.locks) {
      this.release(id);
    }
  }

  private lockPath(runId: string): string {
    return path.join(this.lockDir, `${runId}.lock`);
  }

  private isStale(lockFile: string): boolean {
    // 如果锁文件超过 10 分钟，视为过期
    const stats = require("node:fs").statSync(lockFile);
    return Date.now() - stats.mtimeMs > 10 * 60 * 1000;
  }
}
