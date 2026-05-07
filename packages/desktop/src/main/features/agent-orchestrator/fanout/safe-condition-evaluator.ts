/**
 * Agent Orchestrator — sandboxed condition evaluator.
 *
 * Pipelines may carry small boolean expressions in stage prompts and
 * fan-in `when` clauses. We REFUSE to use `eval` / `new Function` for
 * those — instead we parse a tiny subset of JS-like expressions and
 * walk a hand-rolled AST against a context value.
 *
 * Supported grammar (left-to-right, no precedence escalation beyond
 * what's listed):
 *   • literals: `true`, `false`, `null`, integers, decimal numbers,
 *     single- or double-quoted strings (no escapes besides `\\` and `\"`)
 *   • identifier path: `foo.bar.baz` (dots only, no `[ ]` indexing)
 *   • equality: `===`, `!==`, `==`, `!=`
 *   • comparison: `<`, `<=`, `>`, `>=`
 *   • logical: `!expr`, `expr && expr`, `expr || expr`
 *   • parentheses: `(expr)`
 *
 * Anything else (function calls, ternary, bitwise, `[]`, template
 * strings, regex, etc.) → throws `SafeEvalSyntaxError`.
 */

export type SafeContext = Record<string, unknown>;

export class SafeEvalSyntaxError extends Error {
  constructor(message: string) {
    super(`[safe-eval] ${message}`);
    this.name = "SafeEvalSyntaxError";
  }
}

export class SafeEvalRuntimeError extends Error {
  constructor(message: string) {
    super(`[safe-eval] ${message}`);
    this.name = "SafeEvalRuntimeError";
  }
}

type Token =
  | { kind: "num"; value: number }
  | { kind: "str"; value: string }
  | { kind: "ident"; value: string }
  | { kind: "op"; value: string }
  | { kind: "lparen" }
  | { kind: "rparen" };

const OPERATORS = ["===", "!==", "==", "!=", "<=", ">=", "<", ">", "&&", "||", "!"] as const;

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === " " || ch === "\t" || ch === "\n") {
      i++;
      continue;
    }
    if (ch === "(") {
      tokens.push({ kind: "lparen" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: "rparen" });
      i++;
      continue;
    }
    // strings
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      let value = "";
      while (j < input.length && input[j] !== quote) {
        if (input[j] === "\\" && j + 1 < input.length) {
          const next = input[j + 1];
          if (next === "\\" || next === quote) {
            value += next;
            j += 2;
            continue;
          }
          throw new SafeEvalSyntaxError(`Unsupported escape \\${next}`);
        }
        value += input[j];
        j++;
      }
      if (j >= input.length) throw new SafeEvalSyntaxError("Unterminated string literal");
      tokens.push({ kind: "str", value });
      i = j + 1;
      continue;
    }
    // numbers
    if ((ch >= "0" && ch <= "9") || (ch === "-" && /[0-9]/.test(input[i + 1] ?? ""))) {
      let j = i + 1;
      let saw = false;
      while (j < input.length && /[0-9.]/.test(input[j]!)) {
        if (input[j] === ".") {
          if (saw) break;
          saw = true;
        }
        j++;
      }
      const num = Number(input.slice(i, j));
      if (!Number.isFinite(num))
        throw new SafeEvalSyntaxError(`Bad number near "${input.slice(i, j)}"`);
      tokens.push({ kind: "num", value: num });
      i = j;
      continue;
    }
    // operators
    let matched = false;
    for (const op of OPERATORS) {
      if (input.startsWith(op, i)) {
        tokens.push({ kind: "op", value: op });
        i += op.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    // identifier path
    if (/[A-Za-z_$]/.test(ch!)) {
      let j = i + 1;
      while (j < input.length && /[A-Za-z0-9_$.]/.test(input[j]!)) j++;
      const ident = input.slice(i, j);
      tokens.push({ kind: "ident", value: ident });
      i = j;
      continue;
    }
    throw new SafeEvalSyntaxError(`Unexpected character "${ch}" at ${i}`);
  }
  return tokens;
}

type Node =
  | { type: "lit"; value: unknown }
  | { type: "path"; segments: string[] }
  | { type: "not"; expr: Node }
  | { type: "binary"; op: string; left: Node; right: Node };

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): Node {
    const expr = this.parseOr();
    if (this.pos < this.tokens.length) {
      throw new SafeEvalSyntaxError(`Unexpected trailing token at ${this.pos}`);
    }
    return expr;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private take(): Token {
    const t = this.tokens[this.pos];
    if (!t) throw new SafeEvalSyntaxError("Unexpected end of expression");
    this.pos++;
    return t;
  }

  private matchOp(op: string): boolean {
    const t = this.peek();
    if (t && t.kind === "op" && t.value === op) {
      this.pos++;
      return true;
    }
    return false;
  }

  private parseOr(): Node {
    let left = this.parseAnd();
    while (this.matchOp("||")) {
      const right = this.parseAnd();
      left = { type: "binary", op: "||", left, right };
    }
    return left;
  }

  private parseAnd(): Node {
    let left = this.parseEquality();
    while (this.matchOp("&&")) {
      const right = this.parseEquality();
      left = { type: "binary", op: "&&", left, right };
    }
    return left;
  }

  private parseEquality(): Node {
    let left = this.parseComparison();
    while (true) {
      const op = ["===", "!==", "==", "!="].find((o) => this.matchOp(o));
      if (!op) break;
      const right = this.parseComparison();
      left = { type: "binary", op, left, right };
    }
    return left;
  }

  private parseComparison(): Node {
    let left = this.parseUnary();
    while (true) {
      const op = ["<=", ">=", "<", ">"].find((o) => this.matchOp(o));
      if (!op) break;
      const right = this.parseUnary();
      left = { type: "binary", op, left, right };
    }
    return left;
  }

  private parseUnary(): Node {
    if (this.matchOp("!")) {
      const expr = this.parseUnary();
      return { type: "not", expr };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Node {
    const t = this.take();
    if (t.kind === "lparen") {
      const inner = this.parseOr();
      const close = this.take();
      if (close.kind !== "rparen") throw new SafeEvalSyntaxError("Expected ')'");
      return inner;
    }
    if (t.kind === "num") return { type: "lit", value: t.value };
    if (t.kind === "str") return { type: "lit", value: t.value };
    if (t.kind === "ident") {
      if (t.value === "true") return { type: "lit", value: true };
      if (t.value === "false") return { type: "lit", value: false };
      if (t.value === "null") return { type: "lit", value: null };
      const segments = t.value.split(".");
      if (segments.some((s) => s.length === 0)) {
        throw new SafeEvalSyntaxError(`Empty path segment in "${t.value}"`);
      }
      return { type: "path", segments };
    }
    throw new SafeEvalSyntaxError(`Unexpected token ${JSON.stringify(t)}`);
  }
}

function resolvePath(ctx: SafeContext, segments: readonly string[]): unknown {
  let cur: unknown = ctx;
  for (const seg of segments) {
    if (cur == null) return undefined;
    if (typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function evalNode(node: Node, ctx: SafeContext): unknown {
  switch (node.type) {
    case "lit":
      return node.value;
    case "path":
      return resolvePath(ctx, node.segments);
    case "not":
      return !truthy(evalNode(node.expr, ctx));
    case "binary": {
      if (node.op === "&&") {
        const left = evalNode(node.left, ctx);
        return truthy(left) ? evalNode(node.right, ctx) : left;
      }
      if (node.op === "||") {
        const left = evalNode(node.left, ctx);
        return truthy(left) ? left : evalNode(node.right, ctx);
      }
      const left = evalNode(node.left, ctx);
      const right = evalNode(node.right, ctx);
      switch (node.op) {
        case "===":
          return left === right;
        case "!==":
          return left !== right;
        case "==":
          // eslint-disable-next-line eqeqeq
          return left == right;
        case "!=":
          // eslint-disable-next-line eqeqeq
          return left != right;
        case "<":
          return compare(left, right) < 0;
        case "<=":
          return compare(left, right) <= 0;
        case ">":
          return compare(left, right) > 0;
        case ">=":
          return compare(left, right) >= 0;
      }
      throw new SafeEvalRuntimeError(`Unhandled operator ${node.op}`);
    }
  }
}

function truthy(v: unknown): boolean {
  return Boolean(v);
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  throw new SafeEvalRuntimeError(`Cannot compare ${typeof a} with ${typeof b}`);
}

/**
 * Evaluate a guarded boolean expression against a context.
 *
 * Throws SafeEvalSyntaxError on parse errors and SafeEvalRuntimeError
 * on runtime issues (e.g. comparing string to number). Both can be
 * caught and surfaced as L1/L2 errors by the classifier.
 */
export function safeEvalCondition(expr: string, ctx: SafeContext): boolean {
  const tokens = tokenize(expr);
  const parser = new Parser(tokens);
  const ast = parser.parse();
  return truthy(evalNode(ast, ctx));
}
