import { useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useMemo, type CSSProperties, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { playerHue, playerRandom, playerSigil, SIGIL_SIZE } from "@/lib/social/player-art";
import { t } from "@/lib/settings/language";
import { cn } from "@/lib/utils";

/**
 * The top bar of a main tab, with a small living scene behind it. It is laid out like
 * `PageHeader`: sticky on a phone and in the page's flow on a desktop. Every scene is
 * decoration, so it is hidden from assistive technology and ignores the pointer, and
 * it stops moving for anyone who has asked for less motion (`styles.css`).
 */
function SceneHeader({
  scene,
  heading,
  subtitle,
  actions,
  back,
  style,
  className,
}: {
  scene: ReactNode;
  heading: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: boolean;
  style?: CSSProperties;
  className?: string;
}) {
  const router = useRouter();
  return (
    <header
      className={cn(
        "sticky top-0 z-30 mb-4 overflow-hidden border-b border-border bg-background pt-[env(safe-area-inset-top)] md:relative md:mt-6 md:mb-6 md:rounded-3xl md:border",
        className,
      )}
      style={style}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        {scene}
      </div>
      <div className="relative flex h-[4.5rem] items-center gap-3 px-4 md:h-28 md:px-7">
        {back && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("Go back")}
            onClick={() => router.history.back()}
            className="-ml-2 shrink-0"
          >
            <ArrowLeft />
          </Button>
        )}
        <div className="flex min-w-0 flex-1 items-center gap-3">{heading}</div>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      {subtitle && <span className="sr-only">{subtitle}</span>}
    </header>
  );
}

const TITLE = "truncate pb-0.5 text-[1.7rem] leading-tight font-black tracking-tight md:text-4xl";
const SUBTITLE = "truncate text-xs font-medium text-muted-foreground md:text-sm";

/* ── Explore: a radar, centred on the search button, that lights up games ─────────── */

const FIELD_COLUMNS = 34;
const FIELD_ROWS = 8;
const FIELD_CELL = 12;
const GAME_HUES = 7;

const FIELD = (() => {
  const next = playerRandom("explore");
  const tiles: Array<{ x: number; y: number; hue: number; delay: number }> = [];
  for (let y = 0; y < FIELD_ROWS; y += 1) {
    for (let x = 0; x < FIELD_COLUMNS; x += 1) {
      if (next() < 0.26) {
        tiles.push({
          x,
          y,
          hue: 1 + Math.floor(next() * GAME_HUES),
          delay: next() * 5,
        });
      }
    }
  }
  return tiles;
})();

function ExploreScene() {
  return (
    <>
      <svg
        className="scene-fade-left absolute inset-y-0 right-0 h-full w-full md:w-3/4"
        viewBox={`0 0 ${FIELD_COLUMNS * FIELD_CELL} ${FIELD_ROWS * FIELD_CELL}`}
        preserveAspectRatio="xMaxYMid slice"
      >
        {FIELD.map((tile) => (
          <rect
            key={`${tile.x}-${tile.y}`}
            className="explore-tile"
            x={tile.x * FIELD_CELL + 1.5}
            y={tile.y * FIELD_CELL + 1.5}
            width={FIELD_CELL - 3}
            height={FIELD_CELL - 3}
            rx={2.5}
            fill={`var(--game-${tile.hue})`}
            style={{ animationDelay: `${tile.delay}s` }}
          />
        ))}
      </svg>
      <span className="explore-radar" />
    </>
  );
}

/** The title's "o" as a compass, hunting for something to play. */
function CompassO() {
  return (
    <svg viewBox="0 0 24 24" className="mx-[0.03em] inline-block size-[0.74em] align-[-0.04em]">
      <circle cx="12" cy="12" r="9.6" fill="none" stroke="currentColor" strokeWidth="4.2" />
      <g className="explore-needle">
        <path d="M12 5.4 14.6 12H9.4Z" fill="currentColor" />
        <path d="M12 18.6 9.4 12h5.2Z" fill="var(--muted-foreground)" />
      </g>
    </svg>
  );
}

export function ExploreHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle: string;
  actions: ReactNode;
}) {
  // By letter, because the word is translated. One with no "o" just stays a word.
  const at = title.toLowerCase().indexOf("o");
  return (
    <SceneHeader
      scene={<ExploreScene />}
      heading={
        <div className="min-w-0">
          <h1 className={TITLE}>
            {at < 0 ? (
              title
            ) : (
              <>
                <span className="sr-only">{title}</span>
                <span aria-hidden>
                  {title.slice(0, at)}
                  <CompassO />
                  {title.slice(at + 1)}
                </span>
              </>
            )}
          </h1>
          <p className={SUBTITLE}>{subtitle}</p>
        </div>
      }
      actions={actions}
    />
  );
}

/* ── Inbox: messages drifting up through a warm glow ──────────────────────────────── */

const BUBBLES = [
  { right: "8%", size: 2.6, delay: 0, duration: 7, solid: true },
  { right: "22%", size: 1.5, delay: 2.4, duration: 6, solid: false },
  { right: "36%", size: 2.1, delay: 4.6, duration: 8, solid: false },
  { right: "51%", size: 1.2, delay: 1.2, duration: 6.5, solid: true },
  { right: "64%", size: 1.8, delay: 3.4, duration: 7.5, solid: false },
];

function InboxScene() {
  return (
    <>
      {BUBBLES.map((bubble) => (
        <span
          key={bubble.right}
          className={cn("inbox-bubble", bubble.solid && "inbox-bubble-solid")}
          style={{
            right: bubble.right,
            width: `${bubble.size}rem`,
            height: `${bubble.size * 0.72}rem`,
            animationDelay: `${bubble.delay}s`,
            animationDuration: `${bubble.duration}s`,
          }}
        />
      ))}
    </>
  );
}

export function InboxHeader({
  title,
  unread,
  actions,
}: {
  title: string;
  /** Unread messages across every chat. Undefined until they've been read. */
  unread?: number;
  actions?: ReactNode;
}) {
  return (
    <SceneHeader
      scene={<InboxScene />}
      heading={
        <div className="min-w-0">
          <h1 className={TITLE}>{title}</h1>
          {unread !== undefined && (
            <p className={cn(SUBTITLE, "flex items-center gap-1.5")}>
              {unread > 0 && <span className="inbox-pulse" aria-hidden />}
              {unread > 0 ? t("{count} unread", { count: unread }) : t("No unread chats")}
            </p>
          )}
        </div>
      }
      actions={actions}
    />
  );
}

/* ── Profile: tinted with the player's own colour, with their mark ─────────────────── */

const STRIP_COLUMNS = 26;
const STRIP_ROWS = 6;
const STRIP_CELL = 12;

function PlayerStrip({ username }: { username: string }) {
  const cells = useMemo(() => {
    const next = playerRandom(`strip:${username}`);
    const lit: Array<{ x: number; y: number; opacity: number }> = [];
    for (let y = 0; y < STRIP_ROWS; y += 1) {
      for (let x = 0; x < STRIP_COLUMNS; x += 1) {
        if (next() < 0.1 + (x / STRIP_COLUMNS) * 0.45) {
          lit.push({ x, y, opacity: 0.25 + next() * 0.6 });
        }
      }
    }
    return lit;
  }, [username]);

  return (
    <svg
      className="absolute inset-y-0 right-0 h-full w-2/3"
      viewBox={`0 0 ${STRIP_COLUMNS * STRIP_CELL} ${STRIP_ROWS * STRIP_CELL}`}
      preserveAspectRatio="xMaxYMid slice"
      style={{ maskImage: "linear-gradient(to left, black, transparent)" }}
    >
      {cells.map((cell) => (
        <rect
          key={`${cell.x}-${cell.y}`}
          x={cell.x * STRIP_CELL + 1.5}
          y={cell.y * STRIP_CELL + 1.5}
          width={STRIP_CELL - 3}
          height={STRIP_CELL - 3}
          rx={2.5}
          fill="var(--player-tile)"
          opacity={cell.opacity}
        />
      ))}
    </svg>
  );
}

function Sigil({ username }: { username: string }) {
  const tiles = useMemo(() => playerSigil(username), [username]);
  return (
    <span aria-hidden className="player-sigil">
      <svg viewBox={`0 0 ${SIGIL_SIZE} ${SIGIL_SIZE}`} className="size-full">
        {tiles.map((tile) => (
          <rect
            key={`${tile.x}-${tile.y}`}
            className="player-sigil-tile"
            x={tile.x + 0.06}
            y={tile.y + 0.06}
            width={0.88}
            height={0.88}
            rx={0.18}
            style={{ animationDelay: `${(tile.x + tile.y) * 45}ms` }}
          />
        ))}
      </svg>
    </span>
  );
}

export function ProfileSceneHeader({
  username,
  title,
  subtitle,
  back,
  actions,
}: {
  /** Empty until the profile has loaded, which draws the header without any colour. */
  username: string;
  title: string;
  subtitle?: string;
  back?: boolean;
  actions?: ReactNode;
}) {
  return (
    <SceneHeader
      back={back}
      className={username ? "player-header" : undefined}
      style={
        username ? ({ "--player-hue": playerHue(username).toFixed(1) } as CSSProperties) : undefined
      }
      scene={username ? <PlayerStrip username={username} /> : null}
      heading={
        <>
          {username && <Sigil username={username} />}
          <div className="min-w-0">
            <h1 className={TITLE}>{title}</h1>
            {subtitle && <p className={SUBTITLE}>{subtitle}</p>}
          </div>
        </>
      }
      actions={actions}
    />
  );
}
