import type { FileUIPart } from "ai";

import type { FileAttachment } from "../../../../../shared/features/agent/types";

/**
 * Convert FileAttachment[] to AI SDK FileUIPart[] for transport.
 * Text files are skipped — their content is already inlined into the message text.
 */
export function attachmentsToFileParts(attachments?: FileAttachment[]): FileUIPart[] {
  if (!attachments || attachments.length === 0) return [];
  return attachments
    .filter((a) => a.category !== "text")
    .map((a) => ({
      type: "file" as const,
      mediaType: a.mediaType,
      filename: a.filename,
      url: `data:${a.mediaType};base64,${a.base64}`,
    }));
}
