import { Link } from "@tanstack/react-router";
import { ShieldCheck, Trophy } from "lucide-react";
import { useState } from "react";
import { GameArt } from "./GameArt";
import { LeaderboardList, OverallBoardList } from "./Leaderboard";
import { ScrollStrip } from "./ScrollStrip";
import { Page } from "@/components/common";
import { useDocumentTitle } from "@/lib/document-title";
import { MAX_PAGE_SIZE, useGames } from "@/lib/games/catalog";
import type { BoardPeriod, BoardScope } from "@/lib/games/sessions";
import { cn } from "@/lib/utils";

import { t } from "@/lib/settings/language";

/**
 * A row of choices with a thumb that slides to the picked one. Real radio buttons
 * underneath, so arrow keys and screen readers work as they do everywhere else.
 */
function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
  className?: string;
}) {
  const index = options.findIndex((option) => option.value === value);
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("ranks-segmented", className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden
        className="ranks-segmented-thumb"
        style={{
          width: `calc((100% - 0.5rem) / ${options.length})`,
          transform: `translateX(${Math.max(index, 0) * 100}%)`,
        }}
      />
      {options.map((option) => (
        <label
          key={option.value}
          className="ranks-segmented-option"
          data-picked={option.value === value || undefined}
        >
          <input
            type="radio"
            name={label}
            className="sr-only"
            checked={option.value === value}
            onChange={() => onChange(option.value)}
          />
          <span className="truncate">{option.label}</span>
        </label>
      ))}
    </div>
  );
}

/**
 * The leaderboard screen.
 *
 * Both halves are real. The game strip comes from the catalogue, so a game
 * published tomorrow appears without a code change; the board under it is the
 * persisted ranking from `GET /api/v1/games/{slug}/leaderboard`, which is derived
 * from verified scores only. A game nobody has finished shows an empty board that
 * says so — never a plausible-looking fixture list.
 *
 * The all-time window is the default because it is the one that can show every
 * recorded score; the shorter windows are real filters over the same data.
 *
 * `gameId` is a catalogue slug, matching the URL the game pages use. Without one,
 * `/leaderboards` is the all-games board: every player's per-game percentiles,
 * summed, so one ranking covers games whose scores are on different scales.
 */
export function LeaderboardPage({
  gameId,
  initialScope = "global",
  initialPeriod = "all",
}: {
  gameId?: string;
  /** Where the page opens: the league card opens it on Following, this week. */
  initialScope?: BoardScope;
  initialPeriod?: BoardPeriod;
}) {
  const [scope, setScope] = useState<BoardScope>(initialScope);
  const [period, setPeriod] = useState<BoardPeriod>(initialPeriod);
  // Every game, not a first page: a game left out of this strip has no other way to
  // reach its board, and its own board could not name it in the title.
  const { status, items } = useGames({ limit: MAX_PAGE_SIZE });
  const game = items.find((g) => g.slug === gameId);
  useDocumentTitle(
    game
      ? t("{title} leaderboard", { title: game.title })
      : gameId
        ? undefined
        : t("All games leaderboard"),
  );

  return (
    <Page>
      {/* No back arrow: Ranks is a top-level tab, and every board is one tap away in
          the strip below, so there is no list page to go back to. */}
      <header className="ranks-hero">
        <span aria-hidden className="ranks-hero-word">
          {t("Ranks")}
        </span>
        <div className="relative flex items-center gap-3.5 md:gap-5">
          <span aria-hidden className="ranks-emblem">
            {gameId ? (
              <GameArt id={gameId} className="size-full" />
            ) : (
              <Trophy className="size-7 md:size-9" fill="currentColor" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="line-clamp-2 text-[1.7rem] leading-[1.1] font-black tracking-tight md:text-4xl">
              {game
                ? t("{title} leaderboard", { title: game.title })
                : gameId
                  ? t("Leaderboards")
                  : t("All games")}
            </h1>
            <p className="mt-1 flex items-center gap-1 text-xs font-medium text-muted-foreground md:text-sm">
              <ShieldCheck className="size-3.5 shrink-0 text-success" aria-hidden />
              {t("Verified scores only.")}
            </p>
          </div>
        </div>
      </header>

      {/* Room on every side for the selected tile's ring, which the strip would clip. */}
      <ScrollStrip className="gap-2.5 px-4 pt-2 pb-4 md:px-1">
        <Link
          to="/leaderboards"
          // Exact, or every game's board would count as this chip's page too, and
          // the strip would centre this chip instead of the selected game.
          activeOptions={{ exact: true }}
          className="ranks-cartridge press"
          data-active={!gameId || undefined}
        >
          <span className="ranks-cartridge-art bg-surface-2 text-foreground">
            <Trophy className="size-6" aria-hidden />
          </span>
          <span className="ranks-cartridge-name">{t("All games")}</span>
        </Link>
        {items.map((g) => (
          <Link
            key={g.slug}
            to="/leaderboards/$id"
            params={{ id: g.slug }}
            className="ranks-cartridge press"
            data-active={gameId === g.slug || undefined}
          >
            <span aria-hidden className="ranks-cartridge-art">
              <GameArt id={g.slug} className="size-full" />
            </span>
            <span className="ranks-cartridge-name">{g.title}</span>
          </Link>
        ))}
        {status === "error" && (
          <span className="self-center text-sm text-muted-foreground">
            {t("The catalogue is unavailable, so the game list is empty.")}
          </span>
        )}
      </ScrollStrip>

      <div className="flex flex-wrap items-center gap-2 px-4 pb-5 md:px-0">
        <Segmented
          label={t("Board")}
          value={scope}
          onChange={setScope}
          className="min-w-40 flex-1"
          options={[
            { value: "global", label: t("Global") },
            { value: "friends", label: t("Following") },
          ]}
        />
        <Segmented
          label={t("Time period")}
          value={period}
          onChange={setPeriod}
          className="min-w-60 flex-[1.4]"
          options={[
            { value: "day", label: t("Today") },
            // The calendar week, from Monday: what the weekly league counts.
            { value: "this-week", label: t("This week") },
            { value: "all", label: t("All time") },
          ]}
        />
      </div>

      {gameId ? (
        <LeaderboardList gameSlug={gameId} scope={scope} period={period} showMe arena />
      ) : (
        <OverallBoardList scope={scope} period={period} />
      )}
    </Page>
  );
}
