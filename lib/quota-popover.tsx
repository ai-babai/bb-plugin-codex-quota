import { useEffect, useRef, useState, type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import { usePortalScopeProps } from "./portal-scope";

interface QuotaPopoverProps {
  label: string;
  onRefresh: (input: "hover" | "press") => void;
  title: string;
  trigger: ReactNode;
  children: ReactNode;
}

function useInsideTouchFocus() {
  const inside = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  function start() {
    window.clearTimeout(timer.current);
    inside.current = true;
  }

  function end() {
    // BB can focus the composer as part of a tap on non-focusable card content.
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { inside.current = false; }, 0);
  }

  function keepOpen(event: Event) {
    if (inside.current) event.preventDefault();
  }

  return { start, end, keepOpen };
}

export function QuotaPopover({ label, title, trigger, children, onRefresh }: QuotaPopoverProps) {
  const scope = usePortalScopeProps();
  const insideTouch = useInsideTouchFocus();
  const [mode, setMode] = useState<"closed" | "hover" | "pinned">("closed");
  const closeTimer = useRef<number | undefined>(undefined);
  const passive = useRef(false);

  function cancelClose() {
    window.clearTimeout(closeTimer.current);
  }
  useEffect(() => cancelClose, []);

  function closeAfterLeave() {
    cancelClose();
    // Give the pointer time to cross the gap between the ring and the panel.
    closeTimer.current = window.setTimeout(() => {
      setMode(current => current === "hover" ? "closed" : current);
    }, 200);
  }

  return <Popover.Root open={mode !== "closed"} onOpenChange={open => {
    cancelClose();
    if (open) passive.current = false;
    setMode(open ? "pinned" : "closed");
  }}>
    <Popover.Trigger aria-label={label} onClick={() => onRefresh("press")}
      className="-m-1 inline-flex size-8 shrink-0 cursor-pointer select-none items-center justify-center rounded-full text-teal-600 transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-teal-400"
      onPointerEnter={event => {
        cancelClose();
        if (event.pointerType === "touch") return;
        onRefresh("hover");
        if (mode === "closed") {
          passive.current = true;
          setMode("hover");
        }
      }}
      onPointerLeave={closeAfterLeave}>
      {trigger}
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content {...scope} tabIndex={-1} side="top" align="end" sideOffset={8}
        aria-label={title} onPointerEnter={cancelClose} onPointerLeave={closeAfterLeave}
        onTouchStartCapture={insideTouch.start} onTouchEndCapture={insideTouch.end} onTouchCancelCapture={insideTouch.end}
        onFocusOutside={insideTouch.keepOpen}
        onOpenAutoFocus={event => {
          event.preventDefault();
          if (!passive.current && event.target instanceof HTMLElement) event.target.focus();
        }}
        onCloseAutoFocus={event => { if (passive.current) event.preventDefault(); }}
        className="z-50 grid w-56 max-w-[calc(100vw-2rem)] gap-2 rounded-md border border-border bg-popover p-2 text-xs text-popover-foreground shadow-md outline-none
          data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95
          data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95
          motion-reduce:animate-none!">
        {children}
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}
