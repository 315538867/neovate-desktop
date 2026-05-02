"use client";

import type { ComponentProps, ReactNode, RefObject } from "react";

import { ArrowDownIcon, DownloadIcon } from "lucide-react";
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { usePinnedState } from "./use-pinned-state";

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
  contextRef?: RefObject<ConversationHandle | null>;
  /**
   * Overlay children rendered alongside the virtualized list (e.g. ConversationScrollButton).
   * These render inside the Conversation context provider so they can read atBottom state.
   */
  children?: ReactNode;
};

// Threshold (px) below the geometric bottom that still counts as "at bottom".
// Set generously so collapse/expand of code blocks or reasoning blocks does
// not flip the state.
const AT_BOTTOM_THRESHOLD = 120;

// Debounce window for atBottomStateChange transitions away from true. Entering
// "at bottom" is applied immediately; leaving is delayed to absorb jitter
// produced by short-lived height changes during streaming.
const AT_BOTTOM_LEAVE_DEBOUNCE_MS = 80;

export const Conversation = forwardRef<HTMLDivElement, ConversationProps>(
  ({ items, className, contextRef, children }, _ref) => {
    const handle = useRef<VirtuosoHandle>(null);
    const scrollerRef = useRef<HTMLElement | null>(null);
    const lastScrollTop = useRef(0);
    const [atBottom, setAtBottom] = useState(true);

    // User-intent layer: decoupled from Virtuoso's geometric atBottom.
    // Truth source for whether new content should follow to bottom.
    // Mutating isPinnedRef does not trigger re-renders; Virtuoso re-evaluates
    // the followOutput callback on every items change.
    const { isPinnedRef, pinToBottom } = usePinnedState(scrollerRef);
    const atBottomLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const scrollToBottom = useCallback(
      (behavior: "smooth" | "auto" = "smooth") => {
        // Programmatic scrollToBottom = explicit user intent to follow.
        pinToBottom();
        const last = items.length - 1;
        if (last < 0) return;
        handle.current?.scrollToIndex({ index: last, behavior, align: "end" });
      },
      [items.length, pinToBottom],
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

    // followOutput is a function so Virtuoso re-evaluates it per items change.
    // Returning "auto" (instant) avoids stacking smooth animations against the
    // estimate→measure→correct cycle that produces visible flicker.
    const followOutput = useCallback(() => {
      return isPinnedRef.current ? ("auto" as const) : false;
    }, []);

    // atBottom geometry ONLY drives UI (scroll-to-bottom button visibility).
    // It does NOT drive follow intent — pin (isPinnedRef) is the single truth
    // source, mutated by real user input events (wheel / touch / keyboard /
    // scroll) inside usePinnedState. This decoupling is critical: during
    // streaming the geometric atBottom thrashes within AT_BOTTOM_THRESHOLD as
    // scrollHeight grows; if we re-pinned or imperatively realigned here, a
    // user mid-scroll would be yanked back to bottom (visible flicker + jump).
    // SIZE_INCREASED dead-locks are handled by the items.length useEffect
    // below, which only fires when the user's pin intent is still ON.
    const onAtBottomStateChange = useCallback((b: boolean) => {
      if (atBottomLeaveTimerRef.current) {
        clearTimeout(atBottomLeaveTimerRef.current);
        atBottomLeaveTimerRef.current = null;
      }
      if (b) {
        setAtBottom(true);
      } else {
        atBottomLeaveTimerRef.current = setTimeout(() => {
          setAtBottom(false);
        }, AT_BOTTOM_LEAVE_DEBOUNCE_MS);
      }
    }, []);

    // Follow-intent realignment on new items.
    // When the user has pin ON (intent to follow streaming output) but
    // Virtuoso's internal shouldFollow is gated off (geometric atBottom=false
    // due to a pending SIZE_INCREASED measurement, e.g. user expanded a
    // reasoning block then dragged near bottom), Virtuoso's followOutput
    // alone cannot recover. Force-align imperatively per items.length tick.
    // Guard with isPinnedRef so we NEVER yank a user who is intentionally
    // scrolled away.
    const prevItemsLengthRef = useRef(items.length);
    useEffect(() => {
      const prev = prevItemsLengthRef.current;
      prevItemsLengthRef.current = items.length;
      if (items.length <= prev) return;
      if (!isPinnedRef.current) return;
      const last = items.length - 1;
      if (last >= 0) {
        handle.current?.scrollToIndex({ index: last, behavior: "auto", align: "end" });
      }
    }, [items.length]);

    useEffect(() => {
      return () => {
        if (atBottomLeaveTimerRef.current) {
          clearTimeout(atBottomLeaveTimerRef.current);
        }
      };
    }, []);

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
            followOutput={followOutput}
            atBottomStateChange={onAtBottomStateChange}
            atBottomThreshold={AT_BOTTOM_THRESHOLD}
            increaseViewportBy={200}
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
