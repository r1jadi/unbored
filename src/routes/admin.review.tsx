import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, Inbox, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  AdminListStates,
  AdminPage,
  ConfirmDialog,
  PromptDialog,
  SectionCard,
  StatCard,
  StatusBadge,
  statusTone,
} from "@/components/admin/ui";
import { GameArt } from "@/components/game/GameArt";
import { Button } from "@/components/ui/button";
import {
  ADMIN_LIMIT,
  asApiError,
  formatAgo,
  moderateGame,
  useAdminGames,
  type AdminGame,
} from "@/lib/admin/api";
import { fmt } from "@/lib/format";

import { t } from "@/lib/settings/language";
export const Route = createFileRoute("/admin/review")({
  head: () => ({
    meta: [{ title: t("Review queue — Unbored admin") }, { name: "robots", content: "noindex" }],
  }),
  component: ReviewQueue,
});

/** What a moderator is about to do with a queued game. */
type Pending = { game: AdminGame; decision: "published" | "rejected" } | null;

/**
 * Games waiting on a moderation decision.
 *
 * The queue is exactly the games whose stored status is `review` — nothing is
 * added to it here, and the count above the list is that same query's length
 * rather than a separate statistic that could disagree with it.
 */
export function ReviewQueue() {
  const queue = useAdminGames({ status: "review", limit: ADMIN_LIMIT });
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const rows = queue.status === "ready" ? queue.data.items : [];

  const decide = (game: AdminGame, decision: "published" | "rejected", reason?: string) => {
    setBusy(game.id);
    moderateGame(game.id, decision, reason)
      .then((result) => {
        toast.success(
          result.status === "published"
            ? t("“{title}” is published.", { title: game.title })
            : t("“{title}” was sent back.", { title: game.title }),
        );
        queue.retry();
      })
      .catch((error: unknown) => toast.error(asApiError(error).message))
      .finally(() => setBusy(null));
  };

  return (
    <AdminPage
      title={t("Review queue")}
      subtitle={t(
        "Games submitted for review. Publishing makes a game visible and playable; sending it back returns it to the submitter.",
      )}
    >
      {queue.status === "error" ? (
        <SectionCard>
          <AdminListStates
            state="error"
            onRetry={queue.retry}
            emptyTitle=""
            emptyBody={queue.error.message}
          />
        </SectionCard>
      ) : queue.status === "loading" ? (
        <AdminListStates state="loading" emptyTitle="" rows={4} />
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <StatCard label={t("Waiting for review")} value={String(rows.length)} icon={Inbox} />
            <StatCard
              label={t("With a runtime")}
              value={String(rows.filter((g) => g.playable).length)}
              tone={rows.some((g) => !g.playable) ? "warning" : "muted"}
              delta={
                rows.some((g) => !g.playable)
                  ? t("{length} cannot be played yet", {
                      length: rows.filter((g) => !g.playable).length,
                    })
                  : undefined
              }
            />
            <StatCard
              label={t("Oldest submission")}
              value={rows.length === 0 ? "—" : (formatAgo(rows[rows.length - 1].createdAt) ?? "—")}
            />
          </div>

          {rows.length === 0 ? (
            <SectionCard>
              <AdminListStates
                state="ready"
                emptyTitle={t("Nothing is waiting")}
                emptyBody={t("No game has the review status right now.")}
              />
            </SectionCard>
          ) : (
            <ul className="space-y-3">
              {rows.map((game) => (
                <li key={game.id} className="rounded-xl border border-border bg-surface p-4">
                  <div className="flex flex-wrap items-start gap-4">
                    <span className="relative block size-16 shrink-0 overflow-hidden rounded-lg border border-glass-border">
                      <GameArt
                        id={game.id}
                        className="absolute top-0 left-0 size-40 origin-top-left scale-[0.4]"
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          to="/games/$id"
                          params={{ id: game.slug }}
                          className="text-sm font-semibold hover:underline"
                        >
                          {game.title}
                        </Link>
                        <StatusBadge tone={statusTone(game.status)}>{game.status}</StatusBadge>
                        {game.isOfficial && <StatusBadge tone="info">{t("official")}</StatusBadge>}
                        {!game.playable && (
                          <StatusBadge tone="warning">{t("no runtime")}</StatusBadge>
                        )}
                      </div>
                      {game.tagline && (
                        <p className="mt-1 text-sm text-muted-foreground">{game.tagline}</p>
                      )}
                      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                        <div className="flex gap-1.5">
                          <dt>{t("Owner")}</dt>
                          <dd className="font-medium text-foreground">
                            {game.ownerUsername ? `@${game.ownerUsername}` : "—"}
                          </dd>
                        </div>
                        <div className="flex gap-1.5">
                          <dt>{t("Category")}</dt>
                          <dd className="font-medium text-foreground">
                            {game.categoryName ?? "—"}
                          </dd>
                        </div>
                        <div className="flex gap-1.5">
                          <dt>{t("Runtime")}</dt>
                          <dd className="font-medium text-foreground">{game.runtime ?? "—"}</dd>
                        </div>
                        <div className="flex gap-1.5">
                          <dt>{t("Submitted")}</dt>
                          <dd className="font-medium text-foreground">
                            {formatAgo(game.createdAt) ?? "—"}
                          </dd>
                        </div>
                        <div className="flex gap-1.5">
                          <dt>{t("Runs so far")}</dt>
                          <dd className="font-mono font-medium text-foreground tabular">
                            {fmt(game.plays)}
                          </dd>
                        </div>
                      </dl>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy === game.id}
                        onClick={() => setPending({ game, decision: "rejected" })}
                      >
                        <XCircle />
                        {t("Send back")}
                      </Button>
                      <Button
                        size="sm"
                        disabled={busy === game.id}
                        onClick={() => setPending({ game, decision: "published" })}
                      >
                        <CheckCircle2 />
                        {t("Publish")}
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <ConfirmDialog
        open={pending?.decision === "published"}
        onOpenChange={(open) => !open && setPending(null)}
        title={t("Publish this game?")}
        description={
          pending
            ? t(
                "“{title}” becomes visible and playable. The decision is recorded against your account.",
                { title: pending.game.title },
              )
            : undefined
        }
        confirmLabel={t("Publish")}
        onConfirm={() => {
          if (pending) decide(pending.game, "published");
          setPending(null);
        }}
      />

      <PromptDialog
        open={pending?.decision === "rejected"}
        onOpenChange={(open) => !open && setPending(null)}
        title={t("Send this game back")}
        description={
          pending
            ? t("“{title}” will not be published. The reason is stored with the decision.", {
                title: pending.game.title,
              })
            : undefined
        }
        label={t("What has to change")}
        placeholder={t("Explain what the submitter should fix.")}
        confirmLabel={t("Send back")}
        destructive
        onConfirm={(reason) => {
          if (pending) decide(pending.game, "rejected", reason);
          setPending(null);
        }}
      />
    </AdminPage>
  );
}
