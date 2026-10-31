import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Clock, Search as SearchIcon, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  EmptyState,
  ErrorState,
  FollowButton,
  ListSkeleton,
  Page,
  UserAvatar,
  UserName,
} from "@/components/common";
import { GameRow } from "@/components/game/GameCard";
import { Label } from "@/components/ui/label";
import { catalogErrorMessage, useGames } from "@/lib/games/catalog";
import { listBlockedIds } from "@/lib/settings/blocked";
import { listFollowees, searchProfiles, type PublicProfile } from "@/lib/social/follows";
import { getAuthState, getSessionUserId } from "@/lib/auth/session";
import { seo } from "@/lib/seo";
import { readWithLegacy, safeLocalStorage } from "@/lib/storage";
import { cn } from "@/lib/utils";

type SearchTab = "top" | "games" | "people";

type SearchParams = {
  /** The search term, so a search can be linked to and survives Back. */
  q?: string;
  /** The result tab, when it is not the default "top". */
  tab?: Exclude<SearchTab, "top">;
};

export const Route = createFileRoute("/search")({
  // Lenient on purpose: a hand-edited or old link should open the search page,
  // not an error. The router parses `?q=123` as a number, so that is accepted too.
  validateSearch: (search: Record<string, unknown>): SearchParams => {
    const { q: rawQ, tab: rawTab } = search;
    const q = typeof rawQ === "string" ? rawQ : typeof rawQ === "number" ? String(rawQ) : undefined;
    const tab = rawTab === "games" || rawTab === "people" ? rawTab : undefined;
    return {
      ...(q && q.trim() !== "" ? { q } : {}),
      ...(tab ? { tab } : {}),
    };
  },
  head: () => seo("Search", "Search games, creators and players."),
  component: SearchPage,
});

/** Delays a value until typing settles, so a search box is one request, not one per key. */
function useDebounced<T>(value: T, ms = 250): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

const RECENT_KEY = "unbored-recent-searches";
/** Pre-rename key: read once and moved forward by `readWithLegacy`. */
const LEGACY_RECENT_KEY = "onemore-recent-searches";

function readRecent(): string[] {
  const raw = readWithLegacy(safeLocalStorage(), RECENT_KEY, LEGACY_RECENT_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string").slice(0, 8)
      : [];
  } catch {
    return [];
  }
}

function writeRecent(entries: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(entries.slice(0, 8)));
  } catch {
    // Best effort.
  }
}

function SearchPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/search" });
  const [q, setQ] = useState(search.q ?? "");
  const tab: SearchTab = search.tab ?? "top";
  const [recent, setRecent] = useState<string[]>(() =>
    typeof window === "undefined" ? [] : readRecent(),
  );
  const term = useDebounced(q.trim());

  // The settled term is written to the address bar, replacing the entry rather
  // than adding one per keystroke: the URL can be shared, and Back from a result
  // returns to this search. `written` remembers what this page put there, so the
  // effect below can tell its own update from a Back/Forward or a new link.
  const written = useRef(search.q ?? "");
  useEffect(() => {
    if (term === written.current) return;
    written.current = term;
    void navigate({
      search: (prev) => ({ ...prev, q: term === "" ? undefined : term }),
      replace: true,
    });
  }, [term, navigate]);

  // A change that did not come from typing — Back/Forward between searches, or
  // following a link to `/search?q=…` while already here — sets the box.
  useEffect(() => {
    const incoming = search.q ?? "";
    if (incoming === written.current) return;
    written.current = incoming;
    setQ(incoming);
  }, [search.q]);

  function setTab(next: SearchTab) {
    void navigate({
      search: (prev) => ({ ...prev, tab: next === "top" ? undefined : next }),
      replace: true,
    });
  }

  function remember(value: string) {
    const next = [value, ...recent.filter((x) => x !== value)].slice(0, 8);
    setRecent(next);
    writeRecent(next);
  }

  function clearRecent() {
    setRecent([]);
    writeRecent([]);
  }

  return (
    <Page>
      <div className="sticky top-0 z-30 bg-background/90 px-4 pt-[calc(1.25rem+env(safe-area-inset-top))] pb-4 backdrop-blur-xl md:static md:px-0 md:pt-8">
        <Label htmlFor="q" className="sr-only">
          Search
        </Label>
        <div className="relative">
          <SearchIcon className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            id="q"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && q.trim() !== "") remember(q.trim());
            }}
            placeholder="Search games and people"
            className="h-11 w-full rounded-xl bg-surface pr-10 pl-10 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {q && (
            <button
              aria-label="Clear search"
              onClick={() => setQ("")}
              className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        {q && (
          <div className="mt-3 flex gap-5 border-b border-border text-sm" role="tablist">
            {(["top", "games", "people"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn(
                  "-mb-px border-b-2 pb-2 capitalize",
                  tab === t
                    ? "border-foreground font-medium"
                    : "border-transparent text-muted-foreground",
                )}
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </div>

      {!q && (
        <div className="px-4 md:px-0">
          <div className="mt-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Recent</h2>
            {recent.length > 0 && (
              <button className="text-xs text-muted-foreground" onClick={clearRecent}>
                Clear all
              </button>
            )}
          </div>
          {recent.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">No recent searches.</p>
          ) : (
            <ul className="mt-2">
              {recent.map((r) => (
                <li key={r} className="flex items-center gap-3 py-2.5">
                  <Clock className="size-4 text-muted-foreground" />
                  <button className="flex-1 text-left text-sm" onClick={() => setQ(r)}>
                    {r}
                  </button>
                  <button
                    aria-label={`Remove ${r}`}
                    onClick={() => {
                      const next = recent.filter((x) => x !== r);
                      setRecent(next);
                      writeRecent(next);
                    }}
                  >
                    <X className="size-4 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <h2 className="mt-6 text-sm font-semibold">Popular searches</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {["daily", "puzzle", "reaction", "color merge"].map((s) => (
              <button
                key={s}
                onClick={() => setQ(s)}
                className="press rounded-full bg-surface px-3.5 py-1.5 text-sm"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {q && tab !== "people" && <GameResults term={term} />}
      {q && tab !== "games" && <PeopleResults query={term} only={tab === "people"} />}
    </Page>
  );
}

/**
 * Game results from the catalogue.
 *
 * It is mounted only once there is a term, so an empty search box never causes a
 * request for the whole catalogue. There is no fallback list: a failed search
 * offers a retry, not a different set of games under the visitor's query.
 */
function GameResults({ term }: { term: string }) {
  const { status, items, error, retry } = useGames({ q: term });

  if (status === "loading") return <ListSkeleton rows={5} />;
  if (status === "error") {
    return (
      <ErrorState title="Couldn't search games" body={catalogErrorMessage(error)} onRetry={retry} />
    );
  }
  if (items.length === 0) {
    return (
      <EmptyState
        icon={SearchIcon}
        title={`No games for "${term}"`}
        body="Try a different spelling or a category name."
      />
    );
  }
  return (
    <div>
      {items.map((game) => (
        <GameRow key={game.slug} game={game} />
      ))}
    </div>
  );
}

/**
 * People results from the public profile projection. Blocked accounts are
 * filtered out, and follow state comes from the real follow graph.
 *
 * The rows are published together with the viewer's followees, never before:
 * a button seeded with a definite "not following" while the read was still in
 * flight would keep that default forever (the hook reads a passed state once),
 * so an account the viewer follows showed "Follow" on every search. When the
 * followees cannot be read the answer is unknown, and each row then verifies
 * its own target (`useFollowState` loads it) instead of everyone defaulting.
 */
function PeopleResults({ query, only }: { query: string; only: boolean }) {
  const [people, setPeople] = useState<PublicProfile[] | undefined>(undefined);
  /**
   * The viewer's own followees for this result set. `undefined` means the
   * relationship is unknown — the read failed, or the session was still being
   * restored — and is passed to the buttons as "not known", never as false.
   */
  const [followingIds, setFollowingIds] = useState<Set<string> | undefined>(undefined);
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (query.trim() === "") {
      setPeople([]);
      return;
    }
    let cancelled = false;
    setError(undefined);
    void (async () => {
      try {
        const rows = await searchProfiles(query, 8);
        if (cancelled) return;
        const blocked = await listBlockedIds();
        const visible = rows.filter((row) => !blocked.has(row.id));
        if (cancelled) return;
        // Read the viewer's follow graph *before* the rows are published, so
        // every button mounts with a state the database actually answered.
        const auth = getAuthState();
        let followees: Set<string> | undefined;
        if (auth.status === "authenticated") {
          const actor = getSessionUserId();
          if (actor) {
            try {
              followees = new Set(await listFollowees(actor));
            } catch {
              // Unknown, not "not following": the rows verify their own targets.
            }
          }
        } else if (auth.status === "anonymous") {
          // A signed-out visitor follows nobody; that answer needs no request.
          followees = new Set();
        }
        if (cancelled) return;
        setFollowingIds(followees);
        setPeople(visible);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Couldn't search people.");
          setPeople([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [query, attempt]);

  if (people === undefined) return <ListSkeleton rows={3} />;
  if (error) {
    return (
      <ErrorState
        title="Couldn't search people"
        body={error}
        onRetry={() => setAttempt((n) => n + 1)}
      />
    );
  }
  if (people.length === 0) {
    if (!only) return null;
    return (
      <EmptyState
        icon={SearchIcon}
        title={`No people for "${query}"`}
        body="Try a different spelling."
      />
    );
  }
  return (
    <div>
      {people.map((x) => (
        <div key={x.username} className="enter flex items-center gap-3 px-4 py-3 md:px-0">
          <Link
            to="/u/$username"
            params={{ username: x.username }}
            className="flex min-w-0 flex-1 items-center gap-3"
          >
            <UserAvatar username={x.username} path={x.avatar_path} />
            <div className="min-w-0 text-sm">
              <UserName username={x.username} />
              <p className="truncate text-xs text-muted-foreground">{x.display_name}</p>
            </div>
          </Link>
          <FollowButton userId={x.id} initial={followingIds?.has(x.id)} />
        </div>
      ))}
    </div>
  );
}
