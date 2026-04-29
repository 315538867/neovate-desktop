/**
 * ConcurrencyLimiter — 限制并发 Run 数量。
 * 防止过多并行编排消耗系统资源。
 */
export class ConcurrencyLimiter {
  private active = new Set<string>();
  private waitQueue: Array<{
    id: string;
    resolve: () => void;
  }> = [];

  constructor(private maxConcurrent: number = 3) {}

  /**
   * 尝试获取执行槽位。若已满则排队等待。
   */
  async acquire(id: string): Promise<void> {
    if (this.active.size < this.maxConcurrent) {
      this.active.add(id);
      return;
    }

    return new Promise((resolve) => {
      this.waitQueue.push({ id, resolve });
    });
  }

  /**
   * 释放执行槽位
   */
  release(id: string): void {
    this.active.delete(id);

    // 唤醒下一个等待者
    const next = this.waitQueue.shift();
    if (next) {
      this.active.add(next.id);
      next.resolve();
    }
  }

  /**
   * 当前活跃数
   */
  get activeCount(): number {
    return this.active.size;
  }

  /**
   * 等待队列长度
   */
  get waitingCount(): number {
    return this.waitQueue.length;
  }

  /**
   * 更新最大并发数
   */
  setMaxConcurrent(max: number): void {
    this.maxConcurrent = max;
    // 尝试立即调度等待队列
    while (this.active.size < this.maxConcurrent && this.waitQueue.length > 0) {
      const next = this.waitQueue.shift()!;
      this.active.add(next.id);
      next.resolve();
    }
  }
}
