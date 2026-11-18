import { useEffect, useRef, useState, type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import { usePortalScopeProps } from "./portal-scope";

interface QuotaPopoverProps {
  label: string;
  title: string;
  trigger: ReactNode;
  children: ReactNode;
}

export function QuotaPopover({ label, title, trigger, children }: QuotaPopoverProps) {
  const scope = usePortalScopeProps();
  const [mode, setMode] = useState<"closed" | "hover" | "pinned">("closed");
  const closeTimer = useRef<number | undefined>(undefined);
  const passive = useRef(false);
  const content = useRef<HTMLDivElement>(null);

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
    <Popover.Trigger aria-label={label}
      className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-teal-600 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-teal-400"
      onPointerEnter={event => {
        cancelClose();
        if (event.pointerType !== "touch" && mode === "closed") {
          passive.current = true;
          setMode("hover");
        }
      }}
      onPointerLeave={closeAfterLeave}
      onClick={event => {
        if (mode !== "hover") return;
        event.preventDefault(); // Pin the visible preview instead of toggling it shut.
        cancelClose();
        passive.current = false;
        setMode("pinned");
        if (event.detail === 0) content.current?.focus();
      }}>
      {trigger}
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content {...scope} ref={content} tabIndex={-1} side="top" align="end" sideOffset={8}
        aria-label={title} onPointerEnter={cancelClose} onPointerLeave={closeAfterLeave}
        onOpenAutoFocus={event => { if (passive.current) event.preventDefault(); }}
        onCloseAutoFocus={event => { if (passive.current) event.preventDefault(); }}
        className="z-50 w-72 max-w-[calc(100vw-2rem)] rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-md outline-none
          data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95
          data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95
          motion-reduce:animate-none!">
        {children}
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}
