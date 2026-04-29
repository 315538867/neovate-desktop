/**
 * StageTimeoutService — 管理 stage 级别的超时。
 * 提供默认超时并支持自定义。
 */
export class StageTimeoutService {
  /** 默认超时: 30 分钟 */
  static readonly DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

  /** 各 stage 类型的超时配置 (ms) */
  private overrides = new Map<string, number>();

  /**
   * 获取指定 stage 的超时时间
   */
  getTimeout(stageId: string): number {
    return this.overrides.get(stageId) ?? StageTimeoutService.DEFAULT_TIMEOUT_MS;
  }

  /**
   * 设置指定 stage 的超时时间
   */
  setTimeout(stageId: string, timeoutMs: number): void {
    this.overrides.set(stageId, timeoutMs);
  }

  /**
   * 检查是否已超时
   */
  isTimedOut(startTime: number, stageId: string): boolean {
    const timeout = this.getTimeout(stageId);
    return Date.now() - startTime > timeout;
  }

  /**
   * 获取剩余时间 (ms)
   */
  getRemainingMs(startTime: number, stageId: string): number {
    const timeout = this.getTimeout(stageId);
    const elapsed = Date.now() - startTime;
    return Math.max(0, timeout - elapsed);
  }
}
