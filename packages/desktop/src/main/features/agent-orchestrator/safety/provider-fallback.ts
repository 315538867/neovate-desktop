/**
 * ProviderFallback — 多 provider 降级策略。
 *
 * 当主 provider 不可用时（auth 失败、限流等），自动切换到备用 provider。
 * 当前为基础实现，记录降级策略，执行降级时在 orchestrator 层面处理。
 */
export class ProviderFallback {
  private fallbackChain: string[][] = [];

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
    // 当前 provider 不在链中或已是最后一个，尝试下一 tier 的第一个
    for (let i = 0; i < this.fallbackChain.length; i++) {
      if (this.fallbackChain[i].includes(currentProvider)) {
        return this.fallbackChain[i + 1]?.[0] ?? null;
      }
    }
    return null;
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
}
