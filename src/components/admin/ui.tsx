import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/common";
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
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ layout */

export function AdminPage({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 pt-5 pb-16 md:px-8 md:pt-8 md:pb-14">
      <header className="mb-5 md:mb-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold md:text-2xl">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          </div>
          {actions && (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div>
          )}
        </div>
      </header>
      <div className="enter">{children}</div>
    </div>
  );
}

export function SectionCard({
  title,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-border bg-surface", className)}>
      {title && (
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {action}
        </div>
      )}
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

/* -------------------------------------------------------------------- bits */

export function StatCard({
  label,
  value,
  delta,
  tone = "muted",
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  delta?: string;
  tone?: "success" | "warning" | "destructive" | "muted";
  icon?: typeof Search;
}) {
  const toneClass = {
    success: "text-success",
    warning: "text-warning",
    destructive: "text-destructive",
    muted: "text-muted-foreground",
  }[tone];
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs text-muted-foreground">{label}</p>
        {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />}
      </div>
      <p className="mt-2 font-mono text-xl font-semibold tabular md:text-2xl">{value}</p>
      {delta && <p className={cn("mt-1 text-xs tabular", toneClass)}>{delta}</p>}
    </div>
  );
}

const badgeTones = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  destructive: "bg-destructive/15 text-destructive",
  info: "bg-info/15 text-info",
  primary: "bg-primary/15 text-primary",
  muted: "bg-surface-2 text-muted-foreground",
} as const;

export type BadgeTone = keyof typeof badgeTones;

export function StatusBadge({
  tone = "muted",
  children,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap capitalize",
        badgeTones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Maps common moderation/content statuses to a badge tone. */
export function statusTone(status: string): BadgeTone {
  switch (status) {
    case "active":
    case "published":
    case "resolved":
    case "sent":
    case "approved":
    case "operational":
    case "verified":
      return "success";
    case "flagged":
    case "review":
    case "pending":
    case "scheduled":
    case "changes":
    case "degraded":
    case "open":
      return "warning";
    case "suspended":
    case "rejected":
    case "deleted":
      return "destructive";
    case "new":
    case "info":
      return "info";
    default:
      return "muted";
  }
}

export function MetaRow({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4 py-2 text-sm", className)}>
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right font-medium break-words">{children}</span>
    </div>
  );
}

/* ----------------------------------------------------------------- toolbar */

export function SearchField({
  value,
  onChange,
  placeholder = "Search",
  className,
  label = "Search",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  label?: string;
}) {
  return (
    <div className={cn("relative w-full md:w-auto md:max-w-xs md:flex-1", className)}>
      <Label htmlFor={`s-${label}`} className="sr-only">
        {label}
      </Label>
      <Search className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        id={`s-${label}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-xl bg-surface pr-9 pl-10 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

export function FilterSelect({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label: string;
  className?: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-10 shrink-0 rounded-xl bg-surface px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mb-4 flex flex-wrap items-center gap-2", className)}>{children}</div>;
}

/* ------------------------------------------------------------------- table */

export type Column<T> = {
  key: string;
  head: ReactNode;
  className?: string;
  cell: (row: T) => ReactNode;
};

export function AdminTable<T>({
  columns,
  rows,
  rowKey,
  onRow,
  mobileRow,
  selectedKey,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRow?: (row: T) => void;
  mobileRow: (row: T) => ReactNode;
  selectedKey?: string;
}) {
  return (
    <>
      <div className="hidden overflow-hidden rounded-xl border border-border bg-surface xl:block">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              {columns.map((c) => (
                <TableHead
                  key={c.key}
                  className={cn("h-11 px-4 text-xs font-medium whitespace-nowrap", c.className)}
                >
                  {c.head}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow
                key={rowKey(r)}
                onClick={onRow ? () => onRow(r) : undefined}
                tabIndex={onRow ? 0 : undefined}
                onKeyDown={
                  onRow
                    ? (e) => {
                        if (e.key === "Enter") onRow(r);
                      }
                    : undefined
                }
                className={cn(
                  "border-border last:border-0",
                  onRow && "cursor-pointer",
                  selectedKey === rowKey(r) && "bg-surface-2",
                )}
              >
                {columns.map((c) => (
                  <TableCell key={c.key} className={cn("px-4 py-3 align-middle", c.className)}>
                    {c.cell(r)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface xl:hidden">
        {rows.map((r) => (
          <li key={rowKey(r)}>{mobileRow(r)}</li>
        ))}
      </ul>
    </>
  );
}

export function MobileRow({
  onClick,
  children,
  ariaLabel,
}: {
  onClick?: () => void;
  children: ReactNode;
  ariaLabel?: string;
}) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      aria-label={ariaLabel}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 px-4 py-3 text-left",
        onClick && "press hover:bg-surface-2",
      )}
    >
      {children}
    </Comp>
  );
}

/* ------------------------------------------------------------------ states */

export function AdminListStates({
  state,
  onRetry,
  emptyTitle,
  emptyBody,
  errorBody,
  rows = 6,
  action,
}: {
  state: string;
  onRetry?: () => void;
  emptyTitle: string;
  emptyBody?: string;
  errorBody?: string;
  rows?: number;
  action?: ReactNode;
}) {
  if (state === "loading") return <ListSkeleton rows={rows} />;
  if (state === "error") return <ErrorState onRetry={onRetry} body={errorBody} />;
  return <EmptyState title={emptyTitle} body={emptyBody} action={action} />;
}

/**
 * A screen whose feature has no backend yet.
 *
 * Used where the prototype showed invented rows and working buttons. The panel
 * states what exists, what does not, and what would have to be built — which is
 * more useful to an operator than a list of games that were never featured.
 */
export function UnavailablePanel({
  icon: Icon,
  title,
  body,
  points,
  action,
}: {
  icon: typeof Search;
  title: string;
  body: string;
  points?: string[];
  action?: ReactNode;
}) {
  return (
    <div className="enter rounded-xl border border-border bg-surface px-6 py-14 text-center">
      <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-surface-2">
        <Icon className="size-5 text-muted-foreground" strokeWidth={1.75} />
      </div>
      <p className="font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">{body}</p>
      {points && points.length > 0 && (
        <ul className="mx-auto mt-5 max-w-md space-y-2 text-left text-sm text-muted-foreground">
          {points.map((point) => (
            <li key={point} className="flex gap-2">
              <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground" />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      )}
      {action && <div className="mt-6 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

/* --------------------------------------------------------------- pagination */

export function usePaged<T>(rows: T[], perPage = 8) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const current = Math.min(page, pages);
  const slice = rows.slice((current - 1) * perPage, current * perPage);
  return { page: current, setPage, pages, slice, total: rows.length, perPage };
}

/**
 * Server-side paging: one page of rows at a time, read from the API.
 *
 * The admin API pages by `limit`/`offset` and reports whether another page
 * exists; there is no total, because counting every row to display a page number
 * would cost more than the page. So this renders a range, not a page count.
 */
export function OffsetPager({
  page,
  setPage,
  perPage,
  rows,
  hasMore,
  label = "rows",
}: {
  page: number;
  setPage: (p: number) => void;
  perPage: number;
  rows: number;
  hasMore: boolean;
  label?: string;
}) {
  if (page === 0 && !hasMore) return null;
  const from = rows === 0 ? 0 : page * perPage + 1;
  const to = page * perPage + rows;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
      <p className="text-xs text-muted-foreground tabular">
        {rows === 0 ? `No ${label} on this page` : `Showing ${from}–${to} ${label}`}
      </p>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Previous page"
          disabled={page === 0}
          onClick={() => setPage(Math.max(0, page - 1))}
        >
          <ChevronLeft />
        </Button>
        <span className="px-2 text-xs text-muted-foreground tabular">page {page + 1}</span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Next page"
          disabled={!hasMore}
          onClick={() => setPage(page + 1)}
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

/**
 * Delays a value until typing settles, so a filter box is one request rather
 * than one per keystroke.
 */
export function useDebounced<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

export function Pager({
  page,
  pages,
  setPage,
  total,
  perPage,
  label = "items",
}: {
  page: number;
  pages: number;
  setPage: (p: number) => void;
  total: number;
  perPage: number;
  label?: string;
}) {
  if (total === 0) return null;
  const from = (page - 1) * perPage + 1;
  const to = Math.min(total, page * perPage);
  const windowStart = Math.max(1, Math.min(page - 2, pages - 4));
  const nums = Array.from({ length: Math.min(5, pages) }, (_, i) => windowStart + i);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
      <p className="text-xs text-muted-foreground tabular">
        Showing {from}–{to} of {total} {label}
      </p>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
        >
          <ChevronLeft />
        </Button>
        {nums.map((n) => (
          <Button
            key={n}
            variant={n === page ? "secondary" : "ghost"}
            size="icon"
            aria-current={n === page ? "page" : undefined}
            onClick={() => setPage(n)}
            className="text-xs tabular"
          >
            {n}
          </Button>
        ))}
        <Button
          variant="ghost"
          size="icon"
          aria-label="Next page"
          disabled={page >= pages}
          onClick={() => setPage(page + 1)}
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- dialogs */

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  destructive,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={destructive ? buttonVariants({ variant: "destructive" }) : undefined}
            onClick={onConfirm}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function PromptDialog({
  open,
  onOpenChange,
  title,
  description,
  label = "Reason",
  placeholder,
  confirmLabel = "Submit",
  destructive,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: ReactNode;
  label?: string;
  placeholder?: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: (text: string) => void;
}) {
  const [text, setText] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setText("");
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="prompt-text">{label}</Label>
          <Textarea
            id="prompt-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={placeholder}
            className="bg-surface"
          />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={!text.trim()}
            onClick={() => {
              onConfirm(text.trim());
              setText("");
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------- forms */

export function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export function TextField({
  id,
  label,
  hint,
  ...props
}: { id: string; label: string; hint?: string } & React.ComponentProps<typeof Input>) {
  return (
    <Field id={id} label={label} hint={hint}>
      <Input id={id} className="h-11 rounded-lg bg-surface-2" {...props} />
    </Field>
  );
}
