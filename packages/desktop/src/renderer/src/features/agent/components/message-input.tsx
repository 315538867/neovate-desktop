import Placeholder from "@tiptap/extension-placeholder";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Extension, useEditor, EditorContent, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import debug from "debug";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { FileAttachment, PermissionMode } from "../../../../../shared/features/agent/types";

import { toastManager } from "../../../components/ui/toast";
import { useEventCallback } from "../../../hooks/use-event-callback";
import { useLatestRef } from "../../../hooks/use-latest-ref";
import { cn } from "../../../lib/utils";
import { useConfigStore } from "../../config/store";
import { useSettingsStore } from "../../settings";
import { claudeCodeChatManager } from "../chat-manager";
import { useNewSession } from "../hooks/use-new-session";
import { useSessionMeta } from "../hooks/use-session-meta";
import { useAgentStore } from "../store";
import { extractParts, type ExtractedSendable } from "../utils/extract-parts";
import { extractText } from "../utils/extract-text";
import { buildInsertChatContent, type InsertChatDetail } from "../utils/insert-chat";
import { readFileAsAttachment } from "../utils/read-file-as-attachment";
import { AttachmentPreview } from "./attachment-preview";
import { GradientBorderWrapper } from "./gradient-border-wrapper";
import { createImagePasteExtension } from "./image-paste-extension";
import { InputToolbar } from "./input-toolbar";
import { createMentionExtension } from "./mention-extension";
import { QueryStatus } from "./query-status";
import { createSlashCommandsExtension } from "./slash-commands-extension";

const log = debug("neovate:message-input");

/** Optional structured parts derived from the TipTap doc. The send pipeline
 *  uses these to emit `data-slash-command` parts for the optimistic message,
 *  matching what the SDK transformer produces on replay. */
export type SendParts = ExtractedSendable["parts"];

type Props = {
  onSend: (message: string, attachments?: FileAttachment[], parts?: SendParts) => void;
  onCancel: () => void;
  streaming: boolean;
  disabled?: boolean;
  sessionInitializing?: boolean;
  sessionInitError?: string | null;
  onRetry?: () => void;
  cwd: string;
  dockAttached?: boolean;
  /** Show project selector in toolbar (popup window mode) */
  showProjectSelector?: boolean;
};

const NEW_CHAT_EASTER_EGGS = new Set(["exit", "quit", ":q", ":q!", ":wq", ":wq!"]);

type SessionDraft = {
  content: JSONContent;
  attachments: FileAttachment[];
};

const sessionDrafts = new Map<string, SessionDraft>();

export function MessageInput({
  onSend,
  onCancel,
  streaming,
  disabled,
  sessionInitializing,
  sessionInitError,
  onRetry,
  cwd,
  dockAttached = false,
  showProjectSelector = false,
}: Props) {
  const { t } = useTranslation();
  const cwdRef = useLatestRef(cwd);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorJsonRef = useRef<JSONContent | null>(null);
  const { createNewSession } = useNewSession();

  const activeSessionId = useAgentStore((s) => s.activeSessionId);

  // Subscribe to prompt suggestion from the per-session chat store.
  // Uses useState+useEffect instead of useStore to avoid conditional hook calls
  // (chatStore may be undefined when no session is active).
  const [promptSuggestion, setPromptSuggestion] = useState<string | null>(null);
  useEffect(() => {
    const store = activeSessionId
      ? claudeCodeChatManager.getChat(activeSessionId)?.store
      : undefined;
    if (!store) {
      setPromptSuggestion(null);
      return;
    }
    setPromptSuggestion(store.getState().promptSuggestion);
    return store.subscribe((state) => {
      setPromptSuggestion(state.promptSuggestion);
    });
  }, [activeSessionId]);
  const promptSuggestionRef = useLatestRef(promptSuggestion);

  const clearSuggestion = useEventCallback(() => {
    if (!activeSessionId) return;
    claudeCodeChatManager.getChat(activeSessionId)?.store.setState({ promptSuggestion: null });
  });

  const meta = useSessionMeta(activeSessionId);
  const permissionMode = meta?.permissionMode ?? "default";
  const setPermissionMode = useAgentStore((s) => s.setPermissionMode);

  const togglePlanMode = useEventCallback(() => {
    if (!activeSessionId) return;
    const current =
      useAgentStore.getState().sessions.get(activeSessionId)?.permissionMode ?? "default";
    const configDefault = useConfigStore.getState().permissionMode as PermissionMode;
    const next: PermissionMode = current === "plan" ? configDefault : "plan";
    log("togglePlanMode: %s -> %s (configDefault=%s)", current, next, configDefault);
    setPermissionMode(activeSessionId, next);
    claudeCodeChatManager.getChat(activeSessionId)?.dispatch({
      kind: "configure",
      configure: { type: "set_permission_mode", mode: next },
    });
  });

  const [attachments, setAttachments] = useState<FileAttachment[]>(() =>
    activeSessionId ? (sessionDrafts.get(activeSessionId)?.attachments ?? []) : [],
  );
  const attachmentsRef = useLatestRef(attachments);

  const addAttachments = useCallback((files: FileAttachment[]) => {
    log(
      "addAttachments: adding %d files, ids=%o",
      files.length,
      files.map((f) => f.id),
    );
    setAttachments((prev) => {
      const next = [...prev, ...files];
      log("addAttachments: total attachments now=%d", next.length);
      return next;
    });
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const sendMessageWith = useConfigStore((s) => s.sendMessageWith);
  const sendMessageWithRef = useLatestRef(sendMessageWith);

  const mentionExtension = useMemo(() => createMentionExtension(() => cwdRef.current), []);

  const slashCommandsExtension = useMemo(
    () =>
      createSlashCommandsExtension(() => {
        const { activeSessionId, sessions } = useAgentStore.getState();
        if (!activeSessionId) return [];
        return sessions.get(activeSessionId)?.availableCommands ?? [];
      }),
    [],
  );

  const imagePasteExtension = useMemo(
    () => createImagePasteExtension(addAttachments),
    [addAttachments],
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        bulletList: false,
        orderedList: false,
        blockquote: false,
        bold: false,
        italic: false,
        code: false,
        codeBlock: false,
        strike: false,
        horizontalRule: false,
      }),
      Placeholder.configure({
        placeholder: () => {
          const suggestion = promptSuggestionRef.current;
          if (suggestion) return suggestion + "    Tab to fill · Enter to send";
          return t("chat.placeholder");
        },
      }),
      mentionExtension,
      slashCommandsExtension,
      imagePasteExtension,
      Extension.create({
        name: "chatKeymap",
        addProseMirrorPlugins() {
          const editor = this.editor;
          return [
            new Plugin({
              key: new PluginKey("chatKeymap"),
              props: {
                handleKeyDown(_view, event) {
                  const mode = sendMessageWithRef.current;

                  // Tab: accept prompt suggestion (fill editor)
                  if (event.key === "Tab" && !event.shiftKey) {
                    if (document.querySelector("[data-suggestion-popup]")) return false;
                    const suggestion = promptSuggestionRef.current;
                    if (suggestion && editor.isEmpty) {
                      event.preventDefault();
                      editor.commands.setContent(suggestion);
                      clearSuggestion();
                      return true;
                    }
                    return false;
                  }

                  // Bare Enter (no modifier)
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.altKey &&
                    !event.metaKey &&
                    !event.ctrlKey
                  ) {
                    if (document.querySelector("[data-suggestion-popup]")) return false;

                    if (mode === "cmdEnter") {
                      return false;
                    }

                    event.preventDefault();
                    const text = extractText(editor.getJSON()).trim();

                    // Empty input + suggestion → send suggestion directly
                    const suggestion = promptSuggestionRef.current;
                    if (!text && suggestion) {
                      clearSuggestion();
                      onSend(suggestion);
                      toastManager.add({
                        type: "info",
                        title: t("chat.suggestionSent"),
                        timeout: 2000,
                      });
                      return true;
                    }

                    if (NEW_CHAT_EASTER_EGGS.has(text.toLowerCase())) {
                      editor.commands.clearContent();
                      createNewSession(cwdRef.current);
                      return true;
                    }
                    send();
                    return true;
                  }
                  // Cmd/Ctrl+Enter
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    if (document.querySelector("[data-suggestion-popup]")) return false;

                    if (mode === "cmdEnter") {
                      event.preventDefault();
                      const text = extractText(editor.getJSON()).trim();

                      // Empty input + suggestion → send suggestion directly
                      const suggestion = promptSuggestionRef.current;
                      if (!text && suggestion) {
                        clearSuggestion();
                        onSend(suggestion);
                        toastManager.add({
                          type: "info",
                          title: t("chat.suggestionSent"),
                          timeout: 2000,
                        });
                        return true;
                      }

                      if (NEW_CHAT_EASTER_EGGS.has(text.toLowerCase())) {
                        editor.commands.clearContent();
                        createNewSession(cwdRef.current);
                        return true;
                      }
                      send();
                      return true;
                    }

                    editor.commands.setHardBreak();
                    return true;
                  }
                  if (event.key === "Enter" && event.altKey) {
                    editor.commands.setHardBreak();
                    return true;
                  }
                  if (event.key === "Tab" && event.shiftKey) {
                    event.preventDefault();
                    togglePlanMode();
                    return true;
                  }
                  if (event.key === "Escape") {
                    // Dismiss suggestion first, then blur on next Escape
                    if (promptSuggestionRef.current) {
                      clearSuggestion();
                      return true;
                    }
                    editor.commands.blur();
                    return true;
                  }
                  return false;
                },
              },
            }),
          ];
        },
      }),
    ],
    editorProps: {
      attributes: {
        class:
          "tiptap min-h-[76px] max-h-[240px] overflow-y-auto px-3 py-2 text-sm outline-none bg-background-secondary",
      },
      transformPastedHTML(html) {
        const doc = new DOMParser().parseFromString(html, "text/html");
        const text = doc.body.innerText || "";
        return text
          .split("\n")
          .map((line) => {
            if (!line) return "<p></p>";
            const escaped = line
              .replaceAll("&", "&amp;")
              .replaceAll("<", "&lt;")
              .replaceAll(">", "&gt;");
            return `<p>${escaped}</p>`;
          })
          .join("");
      },
    },
    editable: !disabled,
    autofocus: "end",
    content: activeSessionId ? sessionDrafts.get(activeSessionId)?.content : undefined,
    onCreate: ({ editor: e }) => {
      editorJsonRef.current = e.getJSON();
    },
    onUpdate: ({ editor: e }) => {
      editorJsonRef.current = e.getJSON();
    },
  });

  const send = useEventCallback(() => {
    if (!editor || streaming) return;
    const extracted = extractParts(editor.getJSON());
    let text = extracted.text;
    const allAttachments = attachmentsRef.current;
    log(
      "send: text=%s attachments.length=%d ids=%o",
      text.slice(0, 50),
      allAttachments.length,
      allAttachments.map((a) => a.id),
    );
    if (allAttachments.length > 0) {
      log(
        "send: attachment details: %o",
        allAttachments.map((a) => ({
          id: a.id,
          filename: a.filename,
          category: a.category,
          mediaType: a.mediaType,
          base64Len: a.base64?.length ?? 0,
          textLen: a.textContent?.length ?? 0,
        })),
      );
    }

    if (!text && allAttachments.length === 0) return;

    // Inline text-file content as markdown code fences
    const textAttachments = allAttachments.filter((a) => a.category === "text");
    const mediaAttachments = allAttachments.filter((a) => a.category !== "text");

    // Always pass the structured parts: `extractParts` produces the canonical
    // shape (text/slash-command/etc.) that downstream code (`chat.ts` optimistic
    // push, `session-manager.send` collapsing back to a flat string via
    // `extractReadableUserText`) handles uniformly. The previous
    // `hasSlashCommand ? parts : undefined` gated this on slash commands only,
    // forcing two divergent code paths.
    let parts: typeof extracted.parts = extracted.parts;
    if (textAttachments.length > 0) {
      const codeBlocks = textAttachments
        .map((a) => {
          const ext = a.filename.split(".").pop() ?? "";
          const content = a.textContent ?? "";
          return `\`\`\`${ext} filename=${a.filename}\n${content}\n\`\`\``;
        })
        .join("\n\n");
      text = text ? `${text}\n\n${codeBlocks}` : codeBlocks;
      // Mirror the string append in the structured parts so the optimistic
      // render still shows the code fences.
      parts = [
        ...parts,
        {
          type: "text",
          text: parts.length > 0 ? `\n\n${codeBlocks}` : codeBlocks,
          state: "done",
        } as (typeof parts)[number],
      ];
    }

    onSend(text, mediaAttachments.length > 0 ? mediaAttachments : undefined, parts);
    editor.commands.clearContent();
    setAttachments([]);
    if (activeSessionId) sessionDrafts.delete(activeSessionId);
  });

  // Keep editable in sync with props
  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  // Save draft on unmount so it persists across session switches
  useEffect(() => {
    return () => {
      if (!activeSessionId) return;
      const json = editorJsonRef.current;
      if (!json) return;
      const imgs = attachmentsRef.current;
      if (extractText(json).trim() || imgs.length > 0) {
        sessionDrafts.set(activeSessionId, { content: json, attachments: imgs });
      } else {
        sessionDrafts.delete(activeSessionId);
      }
    };
  }, [activeSessionId]);

  // Restore draft when session switches without remount (e.g., between new sessions in welcome panel)
  const prevSessionIdRef = useRef(activeSessionId);
  useEffect(() => {
    if (prevSessionIdRef.current === activeSessionId) return;
    prevSessionIdRef.current = activeSessionId;
    if (!editor || editor.isDestroyed) return;
    const draft = activeSessionId ? sessionDrafts.get(activeSessionId) : undefined;
    if (draft) {
      editor.commands.setContent(draft.content);
      setAttachments(draft.attachments);
    } else {
      editor.commands.clearContent();
      setAttachments([]);
    }
  }, [editor, activeSessionId]);

  // Force placeholder re-render when suggestion changes
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.view.dispatch(editor.state.tr.setMeta("promptSuggestion", promptSuggestion));
    // Focus input so Tab/Enter work immediately on the suggestion.
    // Guard with document.hasFocus() because MessageInput is used in both
    // the main window and popup window (shared activeSessionId) — without
    // this, both windows would try to steal focus simultaneously.
    if (promptSuggestion && document.hasFocus()) {
      requestAnimationFrame(() => {
        editor.commands.focus("end");
      });
    }
  }, [editor, promptSuggestion]);

  // Close suggestion popups when settings opens
  const showSettings = useSettingsStore((s) => s.showSettings);
  useEffect(() => {
    if (showSettings) {
      document.querySelectorAll("[data-suggestion-popup]").forEach((el) => el.remove());
    }
  }, [showSettings]);

  // Focus editor when project is switched
  useEffect(() => {
    if (!editor) return;
    const handler = () => {
      editor.commands.focus("end");
    };
    window.addEventListener("neovate:focus-input", handler);
    return () => window.removeEventListener("neovate:focus-input", handler);
  }, [editor]);

  // Listen for insert-chat events from file tree and other entry points
  useEffect(() => {
    if (!editor) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<InsertChatDetail>).detail ?? {};
      const content = buildInsertChatContent(detail);
      log(
        "insert-chat received textLen=%d mentions=%d",
        detail.text?.length ?? 0,
        detail.mentions?.length ?? 0,
      );
      if (content.length === 0) return;
      editor.chain().focus().insertContent(content).run();
    };
    window.addEventListener("neovate:insert-chat", handler);
    return () => window.removeEventListener("neovate:insert-chat", handler);
  }, [editor]);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      log("handleFileSelect: files=%d", files?.length ?? 0);
      if (!files || files.length === 0) return;
      const acceptedFiles = Array.from(files);
      log("handleFileSelect: accepted=%d", acceptedFiles.length);
      if (acceptedFiles.length === 0) return;
      Promise.all(acceptedFiles.map(readFileAsAttachment)).then(addAttachments);
      e.target.value = "";
    },
    [addAttachments],
  );
  return (
    <div className={cn("px-4 pt-4 pb-1 max-w-3xl mx-auto w-full", dockAttached ? "pb-1 pt-0" : "")}>
      {activeSessionId && <QueryStatus sessionId={activeSessionId} />}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.pdf,.txt,.md,.json,.ts,.tsx,.js,.jsx,.py,.go,.rs,.yaml,.yml,.toml,.xml,.html,.css,.scss,.sh,.bash,.sql,.csv,.log,.env,.gitignore"
        multiple
        className="hidden"
        aria-label={t("chat.attachImages")}
        onChange={handleFileSelect}
      />
      <GradientBorderWrapper
        innerClassName={cn(
          "focus-within:!border-primary/50",
          dockAttached ? "rounded-b-lg rounded-t-[18px]" : "rounded-lg",
        )}
      >
        <AnimatePresence>
          {permissionMode === "plan" && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              <div
                className={cn(
                  "flex items-center gap-1.5 border-b border-info/20 bg-info/5 px-3 py-1 text-xs text-info-foreground",
                  dockAttached ? "rounded-t-[18px]" : "rounded-t-lg",
                )}
              >
                <span className="font-medium">{t("chat.planMode")}</span>
                <span className="text-info-foreground/50">{t("chat.planModeExit")}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <AttachmentPreview attachments={attachments} onRemove={removeAttachment} />
        <div data-has-suggestion={promptSuggestion ? "" : undefined}>
          <EditorContent editor={editor} />
        </div>
        <InputToolbar
          streaming={streaming}
          disabled={disabled}
          sessionInitializing={sessionInitializing}
          sessionInitError={sessionInitError}
          onRetry={onRetry}
          onSend={send}
          onCancel={onCancel}
          onAttach={() => fileInputRef.current?.click()}
          activeSessionId={activeSessionId}
          showProjectSelector={showProjectSelector}
        />
      </GradientBorderWrapper>
    </div>
  );
}
