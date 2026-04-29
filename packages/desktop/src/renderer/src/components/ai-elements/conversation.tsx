"use client";

import type { ComponentProps, ReactNode, RefObject } from "react";

import { ArrowDownIcon, DownloadIcon } from "lucide-react";
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";

// Public handle exposed via `contextRef` — replaces use-stick-to-bottom's
// StickToBottomContext. Internally backed by react-virtuoso for windowed
// rendering of long chat histories.
export type ConversationHandle = {
  scrollToBottom: (behavior?: "smooth" | "auto") => void;
  scrollTop: () => number;
  scrollTo: (top: number) => void;
  scrollerEl: () => HTMLElement | null;
};

type ConversationCtxValue = {
  atBottom: boolean;
  scrollToBottom: (behavior?: "smooth" | "auto") => void;
};

const ConversationCtx = createContext<ConversationCtxValue>({
  atBottom: true,
  scrollToBottom: () => {},
});

export type ConversationProps = {
  items: ReactNode[];
  className?: string;
  /**
   * "smooth" (default) — follow new output smoothly when the user is at bottom.
   * false — don't auto-follow on mount; use this when restoring a saved scroll position.
   */
  initial?: "smooth" | false;
  contextRef?: RefObject<ConversationHandle | null>;
  /**
   * Overlay children rendered alongside the virtualized list (e.g. ConversationScrollButton).
   * These render inside the Conversation context provider so they can read atBottom state.
   */
  children?: ReactNode;
};

export const Conversation = forwardRef<HTMLDivElement, ConversationProps>(
  ({ items, className, initial = "smooth", contextRef, children }, _ref) => {
    const handle = useRef<VirtuosoHandle>(null);
    const scrollerRef = useRef<HTMLElement | null>(null);
    const lastScrollTop = useRef(0);
    const [atBottom, setAtBottom] = useState(true);

    const scrollToBottom = useCallback(
      (behavior: "smooth" | "auto" = "smooth") => {
        const last = items.length - 1;
        if (last < 0) return;
        handle.current?.scrollToIndex({ index: last, behavior, align: "end" });
      },
      [items.length],
    );

    useImperativeHandle(
      contextRef,
      () => ({
        scrollToBottom,
        scrollTop: () => lastScrollTop.current,
        scrollTo: (top: number) => {
          scrollerRef.current?.scrollTo({ top });
        },
        scrollerEl: () => scrollerRef.current,
      }),
      [scrollToBottom],
    );

    const ctxValue = useMemo<ConversationCtxValue>(
      () => ({ atBottom, scrollToBottom }),
      [atBottom, scrollToBottom],
    );

    return (
      <ConversationCtx.Provider value={ctxValue}>
        <div className={cn("relative flex-1 min-h-0", className)} role="log">
          <Virtuoso
            ref={handle}
            data={items}
            scrollerRef={(el) => {
              scrollerRef.current = (el as HTMLElement) ?? null;
            }}
            computeItemKey={(index) => index}
            itemContent={(_, node) => (
              <div className="max-w-3xl mx-auto w-full px-4 pb-4">{node}</div>
            )}
            followOutput={initial === false ? false : "smooth"}
            atBottomStateChange={(b) => {
              setAtBottom(b);
            }}
            atBottomThreshold={4}
            increaseViewportBy={400}
            initialTopMostItemIndex={items.length > 0 ? items.length - 1 : 0}
            onScroll={(e) => {
              lastScrollTop.current = (e.currentTarget as HTMLElement).scrollTop;
            }}
            components={{
              Header: () => <div className="h-3" />,
              Footer: () => <div className="h-3" />,
            }}
            className="h-full"
          />
          {children}
        </div>
      </ConversationCtx.Provider>
    );
  },
);
Conversation.displayName = "Conversation";

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

export const ConversationScrollButton = ({
  className,
  ...props
}: ConversationScrollButtonProps) => {
  const { atBottom, scrollToBottom } = useContext(ConversationCtx);

  const handleScrollToBottom = useCallback(() => {
    scrollToBottom("smooth");
  }, [scrollToBottom]);

  return (
    !atBottom && (
      <Button
        className={cn(
          "absolute bottom-4 left-[50%] translate-x-[-50%] rounded-full bg-background hover:!bg-background hover:!shadow-[0_0_6px_1px_rgba(0,0,0,0.15)] dark:hover:!shadow-[0_0_6px_1px_rgba(255,255,255,0.15)] transition-shadow duration-300 z-50",
          className,
        )}
        onClick={handleScrollToBottom}
        size="icon"
        type="button"
        variant="outline"
        {...props}
      >
        <ArrowDownIcon className="size-4" />
      </Button>
    )
  );
};

export type ConversationEmptyStateProps = ComponentProps<"div"> & {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
};

export const ConversationEmptyState = ({
  className,
  title = "No messages yet",
  description = "Start a conversation to see messages here",
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) => (
  <div
    className={cn(
      "flex size-full flex-col items-center justify-center gap-3 p-8 text-center",
      className,
    )}
    {...props}
  >
    {children ?? (
      <>
        {icon && <div className="text-muted-foreground">{icon}</div>}
        <div className="space-y-1">
          <h3 className="font-medium text-sm">{title}</h3>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
      </>
    )}
  </div>
);

export interface ConversationMessage {
  role: "user" | "assistant" | "system" | "data" | "tool";
  content: string;
}

export type ConversationDownloadProps = Omit<ComponentProps<typeof Button>, "onClick"> & {
  messages: ConversationMessage[];
  filename?: string;
  formatMessage?: (message: ConversationMessage, index: number) => string;
};

const defaultFormatMessage = (message: ConversationMessage): string => {
  const roleLabel = message.role.charAt(0).toUpperCase() + message.role.slice(1);
  return `**${roleLabel}:** ${message.content}`;
};

export const messagesToMarkdown = (
  messages: ConversationMessage[],
  formatMessage: (message: ConversationMessage, index: number) => string = defaultFormatMessage,
): string => messages.map((msg, i) => formatMessage(msg, i)).join("\n\n");

export const ConversationDownload = ({
  messages,
  filename = "conversation.md",
  formatMessage = defaultFormatMessage,
  className,
  children,
  ...props
}: ConversationDownloadProps) => {
  const handleDownload = useCallback(() => {
    const markdown = messagesToMarkdown(messages, formatMessage);
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [messages, filename, formatMessage]);

  return (
    <Button
      className={cn(
        "absolute top-4 right-4 rounded-full dark:bg-background dark:hover:bg-muted",
        className,
      )}
      onClick={handleDownload}
      size="icon"
      type="button"
      variant="outline"
      {...props}
    >
      {children ?? <DownloadIcon className="size-4" />}
    </Button>
  );
};
