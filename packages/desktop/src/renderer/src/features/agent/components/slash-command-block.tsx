import { ChevronDownIcon, TerminalSquareIcon } from "lucide-react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../../components/ui/collapsible";
import { cn } from "../../../lib/utils";

/**
 * Data shape for the `data-slash-command` UI part.
 * Mirrors {@link DataTypes "slash-command"} in `shared/claude-code/types.ts`.
 */
export type SlashCommandData = {
  name: string;
  message?: string;
  args?: string;
  extraText?: string;
  stdout?: string;
  caveat?: string;
};

/**
 * Render a slash-command turn as a chip showing `/cmd args`. Any side-effect
 * fields (`stdout`, `caveat`, `extraText`) are tucked behind a collapsible
 * disclosure — they're useful for traceability but pollute the chat at rest.
 *
 * `variant="inline"` strips the chip's own border/background so it can sit
 * inside a host bubble (e.g. the user message bubble) without producing a
 * double chrome. The mono font + terminal icon still differentiate it from
 * surrounding prose.
 */
export function SlashCommandBlock({
  data,
  variant = "standalone",
}: {
  data: SlashCommandData;
  variant?: "standalone" | "inline";
}) {
  const headline =
    data.args && data.args.length > 0 ? `/${data.name} ${data.args}` : `/${data.name}`;
  const hasDetails = Boolean(data.stdout || data.caveat || data.extraText);
  const isInline = variant === "inline";

  // `self-start` keeps the chip hugging its content when used as a flex-col
  // item (e.g. inside the user message bubble) — without it the parent's
  // `align-items: stretch` would stretch the chip to the bubble's full width.
  const chipBaseClass = isInline
    ? cn("inline-flex self-start items-start gap-1.5", "text-[12px] font-mono text-foreground/90")
    : cn(
        "inline-flex items-start gap-1.5 rounded-2xl border border-border/60",
        "bg-muted/40 px-2.5 py-1 align-middle text-[12px] font-mono",
        "text-foreground/90",
      );

  const triggerBaseClass = isInline
    ? cn(
        "group inline-flex self-start items-start gap-1.5",
        "text-[12px] font-mono text-foreground/90",
        "transition-colors hover:text-foreground",
      )
    : cn(
        "group inline-flex items-start gap-1.5 rounded-2xl border border-border/60",
        "bg-muted/40 px-2.5 py-1 text-[12px] font-mono text-foreground/90",
        "transition-colors hover:bg-muted/60 hover:border-border",
      );

  // Without details we render a plain chip — no Collapsible cost, no chevron.
  if (!hasDetails) {
    return (
      <span className={chipBaseClass}>
        <TerminalSquareIcon className="size-3 shrink-0 mt-[3px] text-muted-foreground" />
        <span className="whitespace-pre-wrap break-all">{headline}</span>
      </span>
    );
  }

  return (
    <Collapsible className={isInline ? "block" : "inline-block align-middle"}>
      <CollapsibleTrigger className={triggerBaseClass}>
        <TerminalSquareIcon className="size-3 shrink-0 mt-[3px] text-muted-foreground" />
        <span className="whitespace-pre-wrap break-all text-left">{headline}</span>
        <ChevronDownIcon
          className={cn(
            "size-3 shrink-0 mt-[3px] text-muted-foreground transition-transform duration-150",
            "group-data-[panel-open]:rotate-180",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1.5 flex flex-col gap-1.5 rounded-md border border-border/50 bg-muted/20 p-2 text-[11px]">
          {data.stdout && <DetailRow label="stdout" value={data.stdout} mono />}
          {data.caveat && <DetailRow label="caveat" value={data.caveat} mono={false} muted />}
          {data.extraText && <DetailRow label="text" value={data.extraText} mono={false} />}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function DetailRow({
  label,
  value,
  mono,
  muted,
}: {
  label: string;
  value: string;
  mono?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{label}</span>
      <pre
        className={cn(
          "m-0 whitespace-pre-wrap break-words leading-relaxed",
          mono ? "font-mono" : "font-sans",
          muted ? "italic text-muted-foreground" : "text-foreground/90",
        )}
      >
        {value}
      </pre>
    </div>
  );
}
