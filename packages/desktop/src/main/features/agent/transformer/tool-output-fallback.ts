/**
 * Predefined sets and converters for restoring tool outputs.
 *
 * On the live path, the SDK attaches a structured `tool_use_result` payload
 * to each tool result. On restore, `getSessionMessages` strips that field,
 * so the transformer falls back to the Anthropic API `content` shape and
 * synthesizes the tool's outputSchema using the converters below.
 *
 * Pulled out of `SDKMessageTransformer` to keep that class focused on the
 * streaming state machine. Behavior must remain bit-for-bit identical to
 * the inlined versions — pure relocation, not a redesign.
 */

import { EditOutputSchema } from "../../../../shared/claude-code/tools/edit";
import { ReadOutputSchema } from "../../../../shared/claude-code/tools/read";
import { isBase64ImageSource, isImageContentBlock, isTextContentBlock } from "./type-guards";

/** Predefined tools whose output should use raw content instead of tool_use_result. */
export const CONTENT_OUTPUT_TOOL_NAMES = new Set([
  "Agent",
  "Task",
  "Bash",
  "Write",
  "MultiEdit",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "TodoWrite",
  "NotebookEdit",
  "BashOutput",
  "Skill",
  "SlashCommand",
  "EnterPlanMode",
  "ExitPlanMode",
  "EnterWorktree",
  "TaskOutput",
  "TaskStop",
]);

/**
 * Content → outputSchema fallback converter entry.
 *
 * On restore, `getSessionMessages` strips `tool_use_result`, so the transformer
 * falls back to the Anthropic API `content` field. Each tool that uses
 * `tool_use_result` (i.e. NOT in CONTENT_OUTPUT_TOOL_NAMES) should register a
 * converter here to transform content into its outputSchema format.
 *
 * The converter output is validated against the schema via `safeParse`.
 * If validation fails, `undefined` is returned (tool renders with no output).
 */
type ContentFallbackConverter = {
  schema: { safeParse: (data: unknown) => { success: boolean; data?: unknown } };
  convert: (content: unknown) => unknown;
};

const CONTENT_FALLBACK_CONVERTERS: Record<string, ContentFallbackConverter> = {
  Edit: {
    schema: EditOutputSchema,
    convert(content) {
      // On restore, content is a raw string (the CLI's text output).
      // We can't reconstruct structuredPatch from it, so return the content
      // as-is and let safeParse reject it — EditTool gracefully falls back
      // to input.old_string / input.new_string when output is undefined.
      return content;
    },
  },
  Read: {
    schema: ReadOutputSchema,
    convert(content) {
      if (typeof content === "string") {
        const totalLines = content.split("\n").length;
        return {
          type: "text",
          file: { filePath: "", content, numLines: totalLines, startLine: 1, totalLines },
        };
      }
      if (!Array.isArray(content)) return content;

      for (const block of content) {
        if (isImageContentBlock(block) && isBase64ImageSource(block.source)) {
          return {
            type: "image",
            file: {
              base64: block.source.data,
              type: block.source.media_type ?? "image/png",
              originalSize: 0,
            },
          };
        }
      }

      const text = content
        .filter(isTextContentBlock)
        .map((b) => b.text)
        .join("\n");
      const totalLines = text.split("\n").length;
      return {
        type: "text",
        file: { filePath: "", content: text, numLines: totalLines, startLine: 1, totalLines },
      };
    },
  },
};

/**
 * Convert an Anthropic API `content` value (returned during restore) into the
 * outputSchema-validated shape that the live path would have produced.
 * Returns `undefined` when the tool has no registered converter, or when
 * the converter output fails its schema validation.
 */
export function contentToOutputSchema(toolName: string, content: unknown): unknown {
  const entry = CONTENT_FALLBACK_CONVERTERS[toolName];
  if (!entry) return undefined;

  const converted = entry.convert(content);
  const result = entry.schema.safeParse(converted);
  return result.success ? result.data : undefined;
}
