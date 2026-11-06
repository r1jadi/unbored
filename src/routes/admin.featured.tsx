import { createFileRoute } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Plus, Save, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AdminListStates, AdminPage, FilterSelect, SectionCard } from "@/components/admin/ui";
import { GameArt } from "@/components/game/GameArt";
import { Button } from "@/components/ui/button";
import {
  asApiError,
  saveAdminFeatured,
  useAdminFeatured,
  useAdminGames,
  type AdminFeaturedGame,
} from "@/lib/admin/api";

import { t } from "@/lib/settings/language";
export const Route = createFileRoute("/admin/featured")({
  head: () => ({
    meta: [{ title: t("Featured games — Unbored admin") }, { name: "robots", content: "noindex" }],
  }),
  component: FeaturedAdmin,
});

const MAX_FEATURED = 12;

type Slot = Pick<AdminFeaturedGame, "gameId" | "slug" | "title">;

/**
 * The editorial list. Explore shows all of it, and the first three open the For You
 * feed. The order is edited here and saved as one write, so players never see half a
 * reorder, and every game added or removed is recorded in the moderation log.
 */
export function FeaturedAdmin() {
  const saved = useAdminFeatured();
  const games = useAdminGames({ status: "published", limit: 100, offset: 0 });
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);

  // Keyed on the answer, not the resource: that object is new on every render, and
  // copying from it each time would throw away an edit as soon as it was made.
  const savedItems = saved.status === "ready" ? saved.data.items : undefined;
  useEffect(() => {
    if (savedItems) setSlots(savedItems);
  }, [savedItems]);

  const original = saved.status === "ready" ? saved.data.items.map((s) => s.gameId).join() : "";
  const dirty = slots !== null && slots.map((s) => s.gameId).join() !== original;

  const options = useMemo(() => {
    if (games.status !== "ready") return [];
    const taken = new Set(slots?.map((s) => s.gameId));
    return games.data.items.filter((game) => !taken.has(game.id));
  }, [games, slots]);

  function move(index: number, by: -1 | 1) {
    setSlots((current) => {
      if (!current) return current;
      const next = [...current];
      const [slot] = next.splice(index, 1);
      if (!slot) return current;
      next.splice(index + by, 0, slot);
      return next;
    });
  }

  function add() {
    const game = options.find((option) => option.id === adding);
    if (!game) return;
    setSlots((current) => [
      ...(current ?? []),
      { gameId: game.id, slug: game.slug, title: game.title },
    ]);
    setAdding("");
  }

  async function save() {
    if (!slots) return;
    setBusy(true);
    try {
      await saveAdminFeatured(slots.map((slot) => slot.gameId));
      toast.success(t("Featured games saved."));
      saved.retry();
    } catch (error) {
      toast.error(asApiError(error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminPage
      title={t("Featured games")}
      subtitle={t("Editorial placement in the feed and Explore.")}
    >
      <SectionCard
        title={t("Featured, in order")}
        bodyClassName="p-0"
        action={
          <Button size="sm" disabled={!dirty || busy} onClick={() => void save()}>
            <Save />
            {t("Save order")}
          </Button>
        }
      >
        {saved.status === "error" ? (
          <AdminListStates
            state="error"
            onRetry={saved.retry}
            emptyTitle=""
            emptyBody={saved.error.message}
          />
        ) : slots === null ? (
          <AdminListStates state="loading" emptyTitle="" rows={4} />
        ) : slots.length === 0 ? (
          <AdminListStates
            state="ready"
            emptyTitle={t("Nothing is featured")}
            emptyBody={t("Add a game below. Until then, Explore leaves this section out.")}
          />
        ) : (
          <ol className="divide-y divide-border">
            {slots.map((slot, index) => (
              <li key={slot.gameId} className="flex items-center gap-3 px-4 py-3">
                <span className="w-5 text-center text-sm text-muted-foreground tabular">
                  {index + 1}
                </span>
                <GameArt id={slot.slug} className="size-10 shrink-0 rounded-lg" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{slot.title}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("Move {title} up", { title: slot.title })}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("Move {title} down", { title: slot.title })}
                  disabled={index === slots.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("Remove {title}", { title: slot.title })}
                  onClick={() =>
                    setSlots((current) =>
                      (current ?? []).filter((other) => other.gameId !== slot.gameId),
                    )
                  }
                >
                  <X />
                </Button>
              </li>
            ))}
          </ol>
        )}
      </SectionCard>

      <SectionCard title={t("Add a game")} className="mt-4" bodyClassName="p-4">
        {games.status === "error" ? (
          <p className="text-sm text-destructive">{games.error.message}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect
              label={t("Published game")}
              value={adding}
              onChange={setAdding}
              options={[
                { value: "", label: t("Choose a published game") },
                ...options.map((game) => ({ value: game.id, label: game.title })),
              ]}
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={adding === "" || (slots?.length ?? 0) >= MAX_FEATURED}
              onClick={add}
            >
              <Plus />
              {t("Add")}
            </Button>
            {(slots?.length ?? 0) >= MAX_FEATURED && (
              <span className="text-xs text-muted-foreground">
                {t("At most 12 games can be featured.")}
              </span>
            )}
          </div>
        )}
      </SectionCard>
    </AdminPage>
  );
}
