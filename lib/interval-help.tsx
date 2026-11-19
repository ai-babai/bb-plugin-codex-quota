import { useEffect, useRef, useState, type PointerEvent } from "react";
import * as Popover from "@radix-ui/react-popover";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";

function keepFocus(event: Event) { event.preventDefault(); }

/** Inline help: the persistent description also works before the bubble opens. */
export function IntervalHelp({ id, text, label }: { id: string; text: string; label: string }) {
  const [mode, setMode] = useState<"closed" | "hover" | "focus" | "pinned">("closed");
  const timer = useRef<number | undefined>(undefined);
  const cancelTimer = () => window.clearTimeout(timer.current);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  function enter(event: PointerEvent) {
    if (event.pointerType === "touch") return;
    cancelTimer();
    if (mode === "closed") timer.current = window.setTimeout(() => setMode("hover"), 150);
  }

  function leave(event: PointerEvent) {
    if (event.pointerType === "touch") return;
    cancelTimer();
    if (mode === "hover") timer.current = window.setTimeout(() => setMode("closed"), 180);
  }

  return <Popover.Root open={mode !== "closed"} onOpenChange={open => {
    cancelTimer();
    setMode(open ? "pinned" : "closed");
  }}>
    <span id={id} className="sr-only">{text}</span>
    <Popover.Trigger type="button" aria-label={label} aria-describedby={id} aria-haspopup={undefined}
      className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-state-hover hover:text-popover-foreground active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(any-pointer:coarse)]:size-7"
      onPointerEnter={enter} onPointerLeave={leave}
      onFocus={() => { cancelTimer(); setMode(current => current === "pinned" ? current : "focus"); }}
      onClick={event => {
        // Focus/hover may preview before the native click. The first press pins it.
        event.preventDefault();
        cancelTimer();
        setMode(current => current === "pinned" ? "closed" : "pinned");
      }}>
      <Icon name="Info" aria-hidden="true" className="size-3" />
    </Popover.Trigger>
    <Popover.Content role="tooltip" aria-label={label} side="top" align="start" sideOffset={4} collisionPadding={8}
      onOpenAutoFocus={keepFocus} onCloseAutoFocus={keepFocus}
      onPointerEnter={cancelTimer} onPointerLeave={leave}
      style={{ maxWidth: "min(12rem, calc(100vw - 1rem), var(--radix-popover-content-available-width))" }}
      className="z-50 rounded border border-border bg-popover px-2 py-1 text-xs whitespace-normal wrap-anywhere text-popover-foreground shadow-sm">
      {text}
    </Popover.Content>
  </Popover.Root>;
}
