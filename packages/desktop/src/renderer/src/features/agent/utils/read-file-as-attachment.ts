import type { FileAttachment } from "../../../../../shared/features/agent/types";

const TEXT_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "json",
  "md",
  "mdx",
  "css",
  "scss",
  "html",
  "htm",
  "xml",
  "yaml",
  "yml",
  "toml",
  "ini",
  "cfg",
  "conf",
  "sh",
  "bash",
  "zsh",
  "fish",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "swift",
  "c",
  "cpp",
  "h",
  "hpp",
  "sql",
  "graphql",
  "txt",
  "log",
  "csv",
  "env",
  "gitignore",
  "dockerfile",
  "makefile",
  "lock",
]);

function fileCategory(file: File): FileAttachment["category"] {
  if (file.type === "application/pdf") return "pdf";
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("text/")) return "text";
  // Detect by extension when MIME is missing or generic
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  if (ext === "pdf") return "pdf";
  // Fallback: treat unknown files as text for reading
  return "text";
}

function guessMediaType(file: File, category: FileAttachment["category"]): string {
  if (file.type) return file.type;
  if (category === "image") return "image/png";
  if (category === "pdf") return "application/pdf";
  return "text/plain";
}

export function readFileAsAttachment(file: File): Promise<FileAttachment> {
  return new Promise((resolve, reject) => {
    const category = fileCategory(file);
    const mediaType = guessMediaType(file, category);
    const reader = new FileReader();

    if (category === "text") {
      // Read text content for inline inclusion in the message
      reader.onload = () => {
        const textContent = reader.result as string;
        resolve({
          id: crypto.randomUUID(),
          filename: file.name || "file",
          mediaType,
          category: "text",
          textContent,
        });
      };
      reader.onerror = reject;
      reader.readAsText(file);
    } else {
      // Read as base64 for image / PDF
      reader.onload = () => {
        const dataUrl = reader.result as string;
        resolve({
          id: crypto.randomUUID(),
          filename: file.name || "file",
          mediaType,
          category,
          base64: dataUrl.split(",")[1],
        });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    }
  });
}
