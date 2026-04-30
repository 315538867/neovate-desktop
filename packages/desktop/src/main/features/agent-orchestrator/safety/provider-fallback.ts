/**
 * ProviderFallback — 多 provider 降级策略。
 *
 * 当主 provider 不可用时（auth 失败、限流等），自动切换到备用 provider。
 * 支持：
 *   - 降级链配置
 *   - Provider 健康状态追踪
 *   - 指数退避重试
 *   - 自动恢复探测
 */
export class ProviderFallback {
  private fallbackChain: string[][] = [];
  private healthStatus = new Map<string, ProviderHealth>();
  private readonly HEALTH_TTL = 300_000; // 5 min

  /**
   * 设置降级链。每个元素是一个 providerId 数组，按优先级排列。
   * 例如: [["anthropic", "openai"], ["google"]]
   * 表示: 首选 anthropic → openai，再不行则 google
   */
  setFallbackChain(chain: string[][]): void {
    this.fallbackChain = chain;
  }

  /**
   * 获取指定 priority 级别的 provider 列表
   */
  getProviders(priority: number): string[] {
    return this.fallbackChain[priority] ?? [];
  }

  /**
   * 获取下一个可用的 provider
   */
  getNextProvider(currentProvider: string): string | null {
    for (const tier of this.fallbackChain) {
      const idx = tier.indexOf(currentProvider);
      if (idx >= 0 && idx < tier.length - 1) {
        return tier[idx + 1];
      }
    }
    for (let i = 0; i < this.fallbackChain.length; i++) {
      if (this.fallbackChain[i].includes(currentProvider)) {
        return this.fallbackChain[i + 1]?.[0] ?? null;
      }
    }
    return null;
  }

  /**
   * 获取最佳可用 provider，跳过不健康的
   */
  getBestAvailableProvider(): string | null {
    for (const tier of this.fallbackChain) {
      for (const provider of tier) {
        if (this.isHealthy(provider)) {
          return provider;
        }
      }
    }
    // 全部不健康时，返回第一个
    return this.fallbackChain[0]?.[0] ?? null;
  }

  /**
   * 检查某个错误 code 是否触发 provider 降级
   */
  shouldFallback(errorCode: string): boolean {
    const fallbackTriggers = [
      "auth_failed",
      "rate_limit_exhausted",
      "network_failed",
      "content_policy",
    ];
    return fallbackTriggers.includes(errorCode);
  }

  /**
   * 标记 provider 为不健康（遇到错误时调用）
   */
  markUnhealthy(provider: string, reason: string): void {
    const health = this.healthStatus.get(provider) ?? {
      isHealthy: true,
      lastError: "",
      consecutiveFailures: 0,
      lastProbeTime: 0,
      nextRetryAfter: 0,
    };

    health.isHealthy = false;
    health.lastError = reason;
    health.consecutiveFailures++;
    // 指数退避: 2^n 秒，最大 5 分钟
    const backoffMs = Math.min(1000 * Math.pow(2, health.consecutiveFailures), 300_000);
    health.nextRetryAfter = Date.now() + backoffMs;

    this.healthStatus.set(provider, health);
  }

  /**
   * 标记 provider 为健康（成功调用时）
   */
  markHealthy(provider: string): void {
    this.healthStatus.set(provider, {
      isHealthy: true,
      lastError: "",
      consecutiveFailures: 0,
      lastProbeTime: Date.now(),
      nextRetryAfter: 0,
    });
  }

  /**
   * 检查 provider 是否健康
   */
  isHealthy(provider: string): boolean {
    const health = this.healthStatus.get(provider);
    if (!health) return true; // 默认健康

    // 健康直接返回
    if (health.isHealthy) return true;

    // 检查是否已过退避时间，可以尝试恢复探测
    if (Date.now() >= health.nextRetryAfter) {
      // 恢复为探测状态（半健康）
      health.lastProbeTime = Date.now();
      return true; // 允许探测性调用
    }

    return false;
  }

  /**
   * 获取 provider 健康状态详情
   */
  getHealth(provider: string): ProviderHealth | undefined {
    return this.healthStatus.get(provider);
  }

  /**
   * 获取所有 provider 健康状态
   */
  getAllHealth(): Map<string, ProviderHealth> {
    return new Map(this.healthStatus);
  }

  /**
   * 清理过期的健康记录
   */
  pruneStaleHealth(): void {
    const cutoff = Date.now() - this.HEALTH_TTL;
    for (const [provider, health] of this.healthStatus) {
      if (health.isHealthy && health.lastProbeTime < cutoff) {
        this.healthStatus.delete(provider);
      }
    }
  }

  /**
   * 获取需要恢复探测的 provider 列表
   */
  getRecoveryCandidates(): string[] {
    const now = Date.now();
    const candidates: string[] = [];
    for (const [provider, health] of this.healthStatus) {
      if (!health.isHealthy && now >= health.nextRetryAfter) {
        candidates.push(provider);
      }
    }
    return candidates;
  }
}

export interface ProviderHealth {
  isHealthy: boolean;
  lastError: string;
  consecutiveFailures: number;
  lastProbeTime: number;
  nextRetryAfter: number;
}
