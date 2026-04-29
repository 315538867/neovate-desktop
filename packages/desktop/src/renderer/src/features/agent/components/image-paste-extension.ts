import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Extension } from "@tiptap/react";
import debug from "debug";

import type { ImageAttachment } from "../../../../../shared/features/agent/types";

import { readFileAsAttachment } from "../utils/read-file-as-attachment";

const log = debug("neovate:image-paste");

type ImagePasteOptions = {
  onImages: (images: ImageAttachment[]) => void;
};

function extractImageFiles(dataTransfer: DataTransfer): File[] {
  const files: File[] = [];
  log(
    "extractImageFiles: files=%d items=%d types=%o",
    dataTransfer.files.length,
    dataTransfer.items?.length ?? 0,
    dataTransfer.types,
  );
  for (let i = 0; i < dataTransfer.files.length; i++) {
    const file = dataTransfer.files[i];
    log("extractImageFiles: file[%d] name=%s type=%s size=%d", i, file.name, file.type, file.size);
    // Accept both known image types AND empty type (some clipboard sources omit MIME)
    if (file.type === "" || file.type.startsWith("image/")) {
      files.push(file);
    }
  }
  // Also check items for clipboard paste (some browsers put images in items, not files)
  if (files.length === 0 && dataTransfer.items) {
    for (let i = 0; i < dataTransfer.items.length; i++) {
      const item = dataTransfer.items[i];
      log("extractImageFiles: item[%d] kind=%s type=%s", i, item.kind, item.type);
      if (item.kind === "file" && (item.type === "" || item.type.startsWith("image/"))) {
        const file = item.getAsFile();
        if (file) {
          log("extractImageFiles: item[%d] -> file name=%s size=%d", i, file.name, file.size);
          files.push(file);
        }
      }
    }
  }
  log("extractImageFiles: result count=%d", files.length);
  return files;
}

/**
 * Extract embedded images from HTML clipboard data.
 * Some applications (rich text editors, office suites) put images
 * only in HTML format, not as file-type clipboard items.
 */
function extractImagesFromHtml(html: string): ImageAttachment[] {
  const results: ImageAttachment[] = [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const imgs = doc.querySelectorAll("img[src^='data:']");
  log("extractImagesFromHtml: found %d data-uri images in HTML", imgs.length);
  for (const img of imgs) {
    const src = img.getAttribute("src") ?? "";
    const commaIdx = src.indexOf(",");
    if (commaIdx === -1) continue;
    // data:<mediatype>;base64,<data>
    const header = src.slice(5, commaIdx); // after "data:"
    const base64 = src.slice(commaIdx + 1);
    const mediaType = header.split(";")[0] || "image/png";
    if (!base64) continue;
    results.push({
      id: crypto.randomUUID(),
      filename: img.getAttribute("alt") || "image",
      mediaType,
      base64,
    });
  }
  return results;
}

function handleImageReadError(err: unknown) {
  log("readFileAsAttachment failed: %s", err instanceof Error ? err.message : String(err));
}

export function createImagePasteExtension(onImages: (images: ImageAttachment[]) => void) {
  return Extension.create<ImagePasteOptions>({
    name: "imagePaste",

    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey("imagePaste"),
          props: {
            handlePaste(_view, event) {
              log("handlePaste: triggered");
              const clipboardData = event.clipboardData;
              if (!clipboardData) {
                log("handlePaste: no clipboardData");
                return false;
              }

              const imageFiles = extractImageFiles(clipboardData);
              if (imageFiles.length > 0) {
                log("handlePaste: found %d images, preventing default", imageFiles.length);
                event.preventDefault();
                Promise.all(imageFiles.map(readFileAsAttachment))
                  .then((attachments) => {
                    log(
                      "handlePaste: resolved %d attachments, ids=%o",
                      attachments.length,
                      attachments.map((a) => a.id),
                    );
                    onImages(attachments);
                  })
                  .catch(handleImageReadError);
                return true;
              }

              // Fallback: check HTML clipboard for embedded images
              const html = clipboardData.getData("text/html");
              if (!html) {
                log("handlePaste: no image files and no HTML data");
                return false;
              }
              const htmlImages = extractImagesFromHtml(html);
              if (htmlImages.length === 0) {
                log("handlePaste: no embedded images in HTML");
                return false;
              }

              log("handlePaste: found %d images in HTML, preventing default", htmlImages.length);
              event.preventDefault();
              onImages(htmlImages);
              return true;
            },

            handleDrop(_view, event) {
              log("handleDrop: triggered");
              const dataTransfer = (event as DragEvent).dataTransfer;
              if (!dataTransfer) {
                log("handleDrop: no dataTransfer");
                return false;
              }

              const imageFiles = extractImageFiles(dataTransfer);
              if (imageFiles.length === 0) {
                log("handleDrop: no image files found");
                return false;
              }

              log("handleDrop: found %d images, preventing default", imageFiles.length);
              event.preventDefault();
              Promise.all(imageFiles.map(readFileAsAttachment))
                .then((attachments) => {
                  log(
                    "handleDrop: resolved %d attachments, ids=%o",
                    attachments.length,
                    attachments.map((a) => a.id),
                  );
                  onImages(attachments);
                })
                .catch(handleImageReadError);
              return true;
            },
          },
        }),
      ];
    },
  });
}
