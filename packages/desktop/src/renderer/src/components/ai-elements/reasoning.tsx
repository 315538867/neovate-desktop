"use client";

import type { ComponentProps, ReactNode } from "react";

import { useControllableState } from "@radix-ui/react-use-controllable-state";
import { BrainIcon, ChevronDownIcon } from "lucide-react";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Streamdown } from "streamdown";

import { markdownPlugins } from "../../lib/markdown";
import { cn } from "../../lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { useConversationContext } from "./conversation";
import { markdownBaseComponents } from "./markdown-base-components";
import { Shimmer } from "./shimmer";
import {
  PIN_DEFER_DELAY_MS,
  PIN_DEFER_POLL_INTERVAL_MS,
  PIN_DEFER_POLL_TIMEOUT_MS,
  useDeferredUntilPinned,
} from "./use-deferred-until-pinned";

interface ReasoningContextValue {
  isStreaming: boolean;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  duration: number | undefined;
}

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

export const useReasoning = () => {
  const context = useContext(ReasoningContext);
  if (!context) {
    throw new Error("Reasoning components must be used within Reasoning");
  }
  return context;
};

export type ReasoningProps = ComponentProps<typeof Collapsible> & {
  isStreaming?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  duration?: number;
};

const MS_IN_S = 1000;

export const Reasoning = memo(
  ({
    className,
    isStreaming = false,
    open,
    defaultOpen,
    onOpenChange,
    duration: durationProp,
    children,
    ...props
  }: ReasoningProps) => {
    const resolvedDefaultOpen = defaultOpen ?? isStreaming;
    // Track if defaultOpen was explicitly set to false (to prevent auto-open)
    const isExplicitlyClosed = defaultOpen === false;

    const [isOpen, setIsOpen] = useControllableState<boolean>({
      defaultProp: resolvedDefaultOpen,
      onChange: onOpenChange,
      prop: open,
    });
    const [duration, setDuration] = useControllableState<number | undefined>({
      defaultProp: undefined,
      prop: durationProp,
    });

    const hasEverStreamedRef = useRef(isStreaming);
    const [hasAutoClosed, setHasAutoClosed] = useState(false);
    const startTimeRef = useRef<number | null>(null);

    // Track when streaming starts and compute duration
    useEffect(() => {
      if (isStreaming) {
        hasEverStreamedRef.current = true;
        if (startTimeRef.current === null) {
          startTimeRef.current = Date.now();
        }
      } else if (startTimeRef.current !== null) {
        setDuration(Math.ceil((Date.now() - startTimeRef.current) / MS_IN_S));
        startTimeRef.current = null;
      }
    }, [isStreaming, setDuration]);

    // Auto-open when streaming starts (unless explicitly closed)
    useEffect(() => {
      if (isStreaming && !isOpen && !isExplicitlyClosed) {
        setIsOpen(true);
      }
    }, [isStreaming, isOpen, setIsOpen, isExplicitlyClosed]);

    const { isPinnedRef, notifyHeightShrink } = useConversationContext();

    // Auto-close when streaming ends. Runs ONLY once, and defers until the
    // user is pinned to bottom so a programmatic collapse never shrinks
    // content the user is currently reading (which caused flicker + yank).
    const shouldAutoClose =
      hasEverStreamedRef.current && !isStreaming && !!isOpen && !hasAutoClosed;
    useDeferredUntilPinned({
      enabled: shouldAutoClose,
      getIsPinned: useCallback(() => isPinnedRef.current ?? true, [isPinnedRef]),
      onCommit: useCallback(() => {
        // Announce the upcoming height shrink so the scroll pinned-state
        // ignores the browser's scrollTop clamp + scrollend side-effect.
        notifyHeightShrink();
        setIsOpen(false);
        setHasAutoClosed(true);
      }, [notifyHeightShrink, setIsOpen]),
      onTimeout: useCallback(() => {
        // Timed out — mark as auto-closed to avoid lingering forever,
        // but do NOT force a collapse on the user.
        setHasAutoClosed(true);
      }, []),
      delayMs: PIN_DEFER_DELAY_MS,
      pollIntervalMs: PIN_DEFER_POLL_INTERVAL_MS,
      timeoutMs: PIN_DEFER_POLL_TIMEOUT_MS,
    });

    const handleOpenChange = useCallback(
      (newOpen: boolean) => {
        // Any close path (user-clicked or programmatic) shrinks height.
        // Pre-mask the conversation pinned-state so the resulting scrollTop
        // clamp can't silently re-engage follow-to-bottom.
        if (!newOpen) {
          notifyHeightShrink();
        }
        setIsOpen(newOpen);
      },
      [setIsOpen, notifyHeightShrink],
    );

    const contextValue = useMemo(
      () => ({ duration, isOpen, isStreaming, setIsOpen }),
      [duration, isOpen, isStreaming, setIsOpen],
    );

    return (
      <ReasoningContext.Provider value={contextValue}>
        <Collapsible
          className={cn("not-prose mb-4", className)}
          onOpenChange={handleOpenChange}
          open={isOpen}
          {...props}
        >
          {children}
        </Collapsible>
      </ReasoningContext.Provider>
    );
  },
);

export type ReasoningTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  getThinkingMessage?: (isStreaming: boolean, duration?: number) => ReactNode;
};

const defaultGetThinkingMessage = (isStreaming: boolean, duration?: number) => {
  if (isStreaming || duration === 0) {
    return <Shimmer duration={1}>Thinking...</Shimmer>;
  }
  if (duration === undefined) {
    return <span>Thought for a few seconds</span>;
  }
  return <span>Thought for {duration} seconds</span>;
};

export const ReasoningTrigger = memo(
  ({
    className,
    children,
    getThinkingMessage = defaultGetThinkingMessage,
    ...props
  }: ReasoningTriggerProps) => {
    const { isStreaming, isOpen, duration } = useReasoning();

    return (
      <CollapsibleTrigger
        className={cn(
          "group flex w-full items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground",
          className,
        )}
        {...props}
      >
        {children ?? (
          <>
            <div className="relative flex size-3 shrink-0 items-center justify-center">
              <BrainIcon className="absolute size-3 transition-opacity duration-150 group-hover:opacity-0" />
              <ChevronDownIcon
                className={cn(
                  "absolute size-3 transition-all duration-150 opacity-0 group-hover:opacity-100",
                  isOpen ? "rotate-0" : "-rotate-90",
                )}
              />
            </div>
            {getThinkingMessage(isStreaming, duration)}
          </>
        )}
      </CollapsibleTrigger>
    );
  },
);

export type ReasoningContentProps = ComponentProps<typeof CollapsibleContent> & {
  children: string;
};

export const ReasoningContent = memo(({ className, children, ...props }: ReasoningContentProps) => (
  <CollapsibleContent
    className={cn(
      "mt-2 text-sm !pl-0",
      "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 text-muted-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
      className,
    )}
    {...props}
  >
    <Streamdown components={markdownBaseComponents} plugins={markdownPlugins}>
      {children}
    </Streamdown>
  </CollapsibleContent>
));

Reasoning.displayName = "Reasoning";
ReasoningTrigger.displayName = "ReasoningTrigger";
ReasoningContent.displayName = "ReasoningContent";
