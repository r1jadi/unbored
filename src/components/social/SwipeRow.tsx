import { Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { t } from "@/lib/settings/language";
import { cn } from "@/lib/utils";

/** How far an open row sits, which is the width of its delete button. */
const OPEN_PX = 92;
/** How far a press moves before it is a swipe or a scroll, and no longer a press. */
const MOVE_PX = 8;
const LONG_PRESS_MS = 450;
/** A swipe past this share of the row deletes it without stopping at the button. */
const FULL_SWIPE = 0.55;
/** A right swipe from the screen's edge is the browser's back gesture, so it is left alone. */
const BACK_GESTURE_PX = 20;
/** Matches `.swipe-row`'s collapse. */
const LEAVE_MS = 220;

/** Only one row is open at a time, as in every list that swipes. */
let closeOpenRow: (() => void) | null = null;

type Gesture = {
  pointer: number;
  x: number;
  y: number;
  from: number;
  swiping: boolean;
  fromEdge: boolean;
};

function buzz() {
  navigator.vibrate?.(10);
}

/**
 * A list row that can be deleted the way social apps do it: swipe it either way to
 * show Delete (a long swipe deletes straight away), or press and hold it. A plain tap
 * still does whatever the row does, so a chat opens as it always has. A mouse can
 * drag the row too, and gets a delete button on hover.
 *
 * `confirm` is what the press asks. `confirmSwipe` asks it of a swipe as well, for a
 * deletion that can't be undone.
 */
export function SwipeRow({
  children,
  className,
  deleteLabel,
  confirm,
  confirmSwipe = false,
  onDelete,
}: {
  children: ReactNode;
  className?: string;
  deleteLabel: string;
  confirm: { title: string; body: string };
  confirmSwipe?: boolean;
  onDelete: () => void;
}) {
  const row = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const pressTimer = useRef<number | undefined>(undefined);
  const leaveTimer = useRef<number | undefined>(undefined);
  // Set when a gesture ends, and read by the click the browser fires straight after,
  // so letting go of a swipe or a press doesn't also open the row.
  const swallowClick = useRef(false);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [asking, setAsking] = useState(false);

  useEffect(
    () => () => {
      window.clearTimeout(pressTimer.current);
      window.clearTimeout(leaveTimer.current);
    },
    [],
  );

  // Touching anything else closes an open row.
  const open = offset !== 0 && !dragging && !leaving;
  useEffect(() => {
    if (!open) return;
    const close = () => setOffset(0);
    closeOpenRow = close;
    const outside = (event: globalThis.PointerEvent) => {
      if (!row.current?.parentElement?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      if (closeOpenRow === close) closeOpenRow = null;
    };
  }, [open]);

  function leave(direction: number) {
    setAsking(false);
    setLeaving(true);
    setOffset(direction * (row.current?.offsetWidth ?? OPEN_PX * 4));
    leaveTimer.current = window.setTimeout(onDelete, LEAVE_MS);
  }

  /** What a swipe or the delete button leads to. */
  function requestDelete(direction: number) {
    if (confirmSwipe) {
      setOffset(direction * OPEN_PX);
      setAsking(true);
    } else {
      leave(direction);
    }
  }

  function endPress() {
    window.clearTimeout(pressTimer.current);
  }

  function ask() {
    endPress();
    gesture.current = null;
    setDragging(false);
    setOffset(0);
    swallowClick.current = true;
    setAsking(true);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (leaving || event.button !== 0) return;
    if (closeOpenRow && offset === 0) closeOpenRow();
    swallowClick.current = false;
    gesture.current = {
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      from: offset,
      swiping: false,
      fromEdge: event.pointerType === "touch" && event.clientX < BACK_GESTURE_PX,
    };
    if (offset !== 0) return;
    pressTimer.current = window.setTimeout(() => {
      buzz();
      ask();
    }, LONG_PRESS_MS);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current || event.pointerId !== current.pointer) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (!current.swiping) {
      if (Math.abs(dx) < MOVE_PX && Math.abs(dy) < MOVE_PX) return;
      endPress();
      // Up and down is the page scrolling, and that is not ours.
      if (Math.abs(dy) > Math.abs(dx) || (dx > 0 && current.fromEdge)) {
        gesture.current = null;
        return;
      }
      current.swiping = true;
      // Only now, because capturing on press would retarget a plain tap away from
      // the link it landed on.
      event.currentTarget.setPointerCapture?.(current.pointer);
      setDragging(true);
    }
    const width = row.current?.offsetWidth ?? 0;
    const next = current.from + dx;
    setOffset(Math.max(-width, Math.min(width, next)));
  }

  function onPointerUp() {
    endPress();
    // No click follows some gestures, and it must not swallow a later Enter on a link.
    window.setTimeout(() => {
      swallowClick.current = false;
    }, 50);
    const current = gesture.current;
    gesture.current = null;
    if (!current?.swiping) return;
    swallowClick.current = true;
    setDragging(false);
    const width = row.current?.offsetWidth ?? 0;
    const direction = offset > 0 ? 1 : -1;
    if (width > 0 && Math.abs(offset) > width * FULL_SWIPE) {
      buzz();
      requestDelete(direction);
    } else {
      setOffset(Math.abs(offset) > OPEN_PX / 2 ? direction * OPEN_PX : 0);
    }
  }

  function onPointerCancel() {
    endPress();
    gesture.current = null;
    setDragging(false);
    setOffset((current) => (Math.abs(current) > OPEN_PX / 2 ? Math.sign(current) * OPEN_PX : 0));
  }

  const width = row.current?.offsetWidth ?? 0;
  const armed = width > 0 && Math.abs(offset) > width * FULL_SWIPE;
  const direction = offset > 0 ? 1 : -1;

  return (
    <li className="swipe-row list-none" data-leaving={leaving || undefined}>
      <div className={cn("relative min-h-0 overflow-hidden", className)}>
        {offset !== 0 && (
          <div
            className={cn(
              "absolute inset-0 flex bg-destructive text-destructive-foreground",
              direction > 0 ? "justify-start" : "justify-end",
            )}
          >
            <button
              type="button"
              aria-label={deleteLabel}
              onClick={() => requestDelete(direction)}
              className="flex h-full flex-col items-center justify-center gap-1 text-xs font-semibold"
              style={{ width: OPEN_PX }}
            >
              <Trash2
                aria-hidden
                className={cn("size-5 transition-transform", armed && "scale-125")}
              />
              {t("Delete")}
            </button>
          </div>
        )}

        <div
          ref={row}
          className="swipe-row-content group/swipe relative bg-background"
          data-dragging={dragging || undefined}
          style={{ transform: offset === 0 ? undefined : `translateX(${offset}px)` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          // A link is draggable by default, and the browser's own drag would end ours.
          onDragStart={(event) => event.preventDefault()}
          // Right-click, and Android's own long press.
          onContextMenu={(event) => {
            event.preventDefault();
            ask();
          }}
          onClickCapture={(event) => {
            if (swallowClick.current) {
              swallowClick.current = false;
              event.preventDefault();
              event.stopPropagation();
            } else if (offset !== 0) {
              // Tapping an open row closes it, rather than leaving the page.
              setOffset(0);
              event.preventDefault();
              event.stopPropagation();
            }
          }}
        >
          {children}
          <button
            type="button"
            aria-label={deleteLabel}
            onClick={() => requestDelete(-1)}
            onPointerDown={(event) => event.stopPropagation()}
            className="press pointer-events-none absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-surface-2 text-muted-foreground opacity-0 group-hover/swipe:opacity-100 hover:bg-destructive hover:text-destructive-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 [@media(pointer:fine)]:pointer-events-auto [@media(pointer:coarse)]:group-hover/swipe:opacity-0"
          >
            <Trash2 aria-hidden className="size-4" />
          </button>
        </div>
      </div>

      <AlertDialog
        open={asking}
        onOpenChange={(next) => {
          setAsking(next);
          if (!next) setOffset(0);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirm.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={() => leave(direction)}
            >
              {t("Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}
