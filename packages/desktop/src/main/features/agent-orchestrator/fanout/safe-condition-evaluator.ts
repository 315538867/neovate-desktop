import type { PipelineTemplate } from "../../../../shared/features/agent-orchestrator/schemas";

/**
 * SafeConditionEvaluator — 安全评估 fanOut.condition 表达式。
 *
 * v1 限定：仅支持简单的 dot-path 属性访问和基础比较。
 * 不执行任意代码，只解析白名单表达式。
 *
 * 支持模式：
 *   - field.length > N          (数组长度比较)
 *   - field.length >= N
 *   - field.length < N
 *   - field.length <= N
 *   - field.length === N
 *   - field                    (truthy 检查)
 *   - !field                   (falsy 检查)
 */
export class SafeConditionEvaluator {
  /**
   * 评估 fanOut condition。
   * @param condition 条件表达式字符串
   * @param upstreamOutputs 上游 stage 输出的 Map (instanceId → output)
   * @param fanOutConfig 模板中的 fanOut 配置
   * @returns true 表示应展开 fanOut
   */
  evaluate(
    condition: string | undefined,
    upstreamOutputs: Map<string, unknown>,
    fanOutConfig: NonNullable<PipelineTemplate["stages"][number]["fanOut"]>,
  ): boolean {
    // 无 condition = 始终展开
    if (!condition || condition.trim() === "") {
      return true;
    }

    const trimmed = condition.trim();

    // 尝试解析 sourceField 的值
    const sourceField = fanOutConfig.sourceField;
    const value = this.resolveDotPath(sourceField, upstreamOutputs);

    try {
      return this.evaluateExpression(trimmed, sourceField, value, upstreamOutputs);
    } catch {
      // 解析失败时保守地跳过 fanOut
      return false;
    }
  }

  /**
   * 从上游输出中解析 dot-path 值。
   * 遍历所有上游输出，找到第一个包含目标字段的输出。
   */
  resolveDotPath(path: string, upstreamOutputs: Map<string, unknown>): unknown {
    // 先尝试直接从某个上游输出中解析整个路径
    for (const output of upstreamOutputs.values()) {
      if (output == null || typeof output !== "object") continue;
      const result = this.dotGet(path, output as Record<string, unknown>);
      if (result !== undefined) return result;
    }

    return undefined;
  }

  /**
   * 安全的 dot-path 属性访问
   */
  private dotGet(path: string, obj: Record<string, unknown>): unknown {
    const parts = path.split(".");
    let current: unknown = obj;

    for (const part of parts) {
      if (current == null || typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }

  /**
   * 评估已解析的条件表达式
   */
  private evaluateExpression(
    expression: string,
    sourceField: string,
    sourceValue: unknown,
    _upstreamOutputs: Map<string, unknown>,
  ): boolean {
    // 裸字段引用: "field" → truthy check
    if (expression === sourceField) {
      return this.isTruthy(sourceValue);
    }

    // 否定: "!field" → falsy check
    if (expression === "!" + sourceField) {
      return !this.isTruthy(sourceValue);
    }

    // 数组长度比较
    const lengthPatterns: Array<{ op: string; fn: (a: number, b: number) => boolean }> = [
      { op: ">=", fn: (a, b) => a >= b },
      { op: "<=", fn: (a, b) => a <= b },
      { op: "!==", fn: (a, b) => a !== b },
      { op: "===", fn: (a, b) => a === b },
      { op: ">", fn: (a, b) => a > b },
      { op: "<", fn: (a, b) => a < b },
    ];

    for (const { op, fn } of lengthPatterns) {
      const prefix = sourceField + ".length " + op + " ";
      if (expression.startsWith(prefix)) {
        const numStr = expression.slice(prefix.length).trim();
        const num = Number(numStr);
        if (isNaN(num)) return false;

        if (Array.isArray(sourceValue)) {
          return fn(sourceValue.length, num);
        }
        return false;
      }
    }

    // 不支持的表达式，保守地返回 false
    return false;
  }

  private isTruthy(value: unknown): boolean {
    if (value == null) return false;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") return value.length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  }
}
