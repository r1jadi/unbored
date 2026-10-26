import { createFileRoute, Link } from "@tanstack/react-router";
import { Clock, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { titleFromSlug, useGame } from "@/lib/games/catalog";
import { GameExits } from "@/components/game/GameExits";

export const Route = createFileRoute("/results/$id")({
  head: ({ params }) => {
    const title = titleFromSlug(params.id);
    return {
      meta: [
        { title: `${title} results — Unbored` },
        { name: "description", content: `${title} on Unbored.` },
        { property: "og:title", content: `${title} results — Unbored` },
      ],
    };
  },
  component: Results,
});

/**
 * The end-of-run screen.
 *
 * A verified score is shown where the run ended — on the play screen's result
 * panel, next to the board that produced it — because a run exists only while it is
 * being played: its session, its action list and its verification all live in that
 * page's memory, and nothing about them is written to storage.
 *
 * So this route cannot show a previous score, and it must not pretend to. The
 * prototype invented a "global rank", a "friends" position and a top-percentile
 * figure here, computed from nothing; this screen instead says where a real result
 * appears and, when the game is playable, offers to start a run.
 */
function Results() {
  const { id } = Route.useParams();
  const state = useGame(id);
  const title = state.status === "ready" ? state.game.title : titleFromSlug(id);
  const playable = state.status === "ready" && state.game.playable && !!state.game.runtime;

  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="enter mt-10 flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-surface-2">
            <Clock className="size-5 text-muted-foreground" />
          </div>
          <h1 className="text-xl font-semibold">No run to show</h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            {playable
              ? `Your score for ${title} appears when a run ends: it is verified on the server, and the panel at the end of the game shows the number it accepted.`
              : `${title} is not playable yet, so no score was recorded.`}
          </p>
          {playable && (
            <Button asChild variant="play" size="lg" className="mt-2">
              <Link to="/play/$id" params={{ id }}>
                <Play className="fill-current" />
                Play {title}
              </Link>
            </Button>
          )}
          <div className="w-full">
            <GameExits slug={id} title={title} />
          </div>
        </div>
      </div>
    </div>
  );
}
