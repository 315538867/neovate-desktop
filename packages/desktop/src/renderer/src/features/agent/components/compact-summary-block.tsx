import { ChevronDownIcon, SparklesIcon } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { MessageResponse } from "../../../components/ai-elements/message";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../../components/ui/collapsible";
import { Separator } from "../../../components/ui/separator";
import { cn } from "../../../lib/utils";
import { useMarkdownComponents } from "../hooks/use-markdown-components";
import { parseCompactSummary } from "../utils/parse-compact-summary";

export type CompactSummaryData = {
  trigger: "manual" | "auto";
  preTokens: number;
  postTokens?: number;
  durationMs?: number;
  summaryRaw: string;
};

function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

export function CompactSummaryBlock({ data }: { data: CompactSummaryData }) {
  const { t } = useTranslation();
  const markdownComponents = useMarkdownComponents();
  const parsed = useMemo(() => parseCompactSummary(data.summaryRaw), [data.summaryRaw]);

  const tokenLabel =
    data.preTokens > 0
      ? `${formatTokens(data.preTokens)}${
          data.postTokens != null ? ` → ${formatTokens(data.postTokens)}` : ""
        } tokens`
      : null;

  const triggerLabel = t(
    data.trigger === "manual"
      ? "chat.messages.compactSummary.triggerManual"
      : "chat.messages.compactSummary.triggerAuto",
    {
      defaultValue:
        data.trigger === "manual" ? "Conversation compacted" : "Conversation auto-compacted",
    },
  );

  return (
    <div className="my-4 w-full">
      <Collapsible>
        <div className="flex items-center gap-3">
          <Separator className="flex-1" />
          <CollapsibleTrigger
            className={cn(
              "group flex items-center gap-1.5 rounded-full border border-border/60 bg-background",
              "px-2.5 py-1 text-[11px] text-muted-foreground transition-colors",
              "hover:text-foreground hover:border-border",
            )}
          >
            <SparklesIcon className="size-3 shrink-0" />
            <span className="font-medium">{triggerLabel}</span>
            {tokenLabel && (
              <>
                <span className="text-muted-foreground/50">·</span>
                <span className="tabular-nums">{tokenLabel}</span>
              </>
            )}
            <ChevronDownIcon
              className={cn(
                "size-3 shrink-0 transition-transform duration-150",
                "group-data-[panel-open]:rotate-180",
              )}
            />
          </CollapsibleTrigger>
          <Separator className="flex-1" />
        </div>
        <CollapsibleContent>
          <div className="mt-3 rounded-lg border border-border/60 bg-muted/30 p-4">
            {parsed.ok ? (
              <div className="flex flex-col gap-3">
                {parsed.intro && (
                  <p className="m-0 text-xs italic text-muted-foreground/80">{parsed.intro}</p>
                )}
                <div className="flex flex-col divide-y divide-border/40">
                  {parsed.sections.map((section) => (
                    <Collapsible key={`${section.index}-${section.title}`}>
                      <CollapsibleTrigger
                        className={cn(
                          "group flex w-full items-center gap-2 py-2 text-left",
                          "text-xs font-medium text-foreground/80 hover:text-foreground",
                        )}
                      >
                        <ChevronDownIcon
                          className={cn(
                            "size-3 shrink-0 -rotate-90 transition-transform duration-150",
                            "group-data-[panel-open]:rotate-0",
                          )}
                        />
                        <span className="text-muted-foreground tabular-nums">{section.index}.</span>
                        <span>{section.title}</span>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="pb-3 pl-5 text-xs text-muted-foreground">
                          <MessageResponse components={markdownComponents}>
                            {section.body}
                          </MessageResponse>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">
                <MessageResponse components={markdownComponents}>{parsed.raw}</MessageResponse>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
