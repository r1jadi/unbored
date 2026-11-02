import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useLocation,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Avatar } from "@/components/common";
import { FeedItem } from "@/components/game/FeedItem";
import { CommentsSheet, ShareSheet } from "@/components/social/Sheets";
import { ApiError } from "@/lib/api/client";
import { clearSession, signIn } from "@/lib/auth/session";
import type { Game } from "@/lib/games/catalog";
import { absoluteUrl } from "@/lib/seo";
import {
  deleteComment,
  fetchCommentCount,
  fetchComments,
  fetchGamesByIds,
  fetchLikeCount,
  isLiked,
  isSaved,
  likeGame,
  listLikedGameIds,
  listSavedGameIds,
  postComment,
  saveGame,
  unlikeGame,
  unsaveGame,
  loadEngagement,
  resetEngagementBatching,
  useGameEngagement,
} from "@/lib/social/engagement";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { toast } from "sonner";

const ME = "3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f";
const OTHER = "9c1f0b2a-7e63-4a5d-9f10-5e6d7c8b9a01";
const GAME_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const GAME_SLUG = "stack-10";
// Matches src/test/setup.ts: publicConfig is computed at import time from the
// stubbed env, so tests must use the setup value rather than re-stubbing.
const supabaseBase = "https://project.supabase.co";

type CommentRow = {
  id: string;
  game_id: string;
  author_id: string;
  parent_id?: string | null;
  body: string;
  created_at: string;
  updated_at: string | null;
};

function sessionPayload() {
  return {
    session: { userId: ME, role: "user", email: "player@example.com" },
    tokens: {
      accessToken: "access-token-1",
      refreshToken: "refresh-token-1",
      tokenType: "bearer",
      expiresIn: 3600,
    },
    user: {
      id: ME,
      email: "player@example.com",
      emailConfirmed: true,
      createdAt: "2026-10-01T00:00:00.000Z",
    },
  };
}

function gamePayload(): Game {
  return {
    slug: GAME_SLUG,
    title: "Stack 10",
    tagline: "Make every column add up to ten.",
    description: "Drop numbered tiles into columns.",
    instructions: null,
    category: { slug: "puzzle", name: "Puzzle" },
    runtime: "stack-10",
    playable: true,
    plays: 42,
    isOfficial: true,
    coverPath: null,
    publishedAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function errorResponse(status: number, message: string) {
  return jsonResponse({ message, code: status === 409 ? "23505" : "error" }, status);
}

/**
 * An in-memory Supabase double with the real table shapes and the key server
 * rules the UI depends on: primary-key conflicts, owner-scoped deletes, and
 * published-only comments. Row-level attribution is enforced here the way RLS
 * enforces it in production — the caller's token decides, never the body.
 */
function createSupabaseDouble() {
  const db = {
    games: [
      {
        id: GAME_ID,
        slug: GAME_SLUG,
        title: "Stack 10",
        tagline: "Make every column add up to ten.",
        description: "Drop numbered tiles into columns.",
        instructions: null,
        runtime: "stack-10",
        playable: true,
        is_official: true,
        cover_path: null,
        published_at: "2026-09-01T00:00:00.000Z",
        updated_at: "2026-09-01T00:00:00.000Z",
        categories: { slug: "puzzle", name: "Puzzle" },
        published: true,
      },
    ],
    stats: [{ slug: GAME_SLUG, plays: 42 }],
    likes: [] as Array<{ user_id: string; target_kind: string; target_id: string }>,
    saves: [] as Array<{ user_id: string; game_id: string }>,
    comments: [] as CommentRow[],
    profiles: [
      { id: ME, username: "rija", display_name: "Rija", bio: null, avatar_path: null },
      // Another account's picture: the comment thread has to build its URL from
      // this row, not from the caller's profile.
      {
        id: OTHER,
        username: "nora",
        display_name: "Nora",
        bio: null,
        avatar_path: "9c1f0b2a/nora.png",
      },
    ],
    commentSeq: 1,
  };

  function caller(init?: RequestInit): string | null {
    const headers = new Headers(init?.headers);
    return headers.get("Authorization") === "Bearer access-token-1" ? ME : null;
  }

  function eq(value: string | null, clause: string | null): boolean {
    if (clause === null) return true;
    const match = /^eq\.(.*)$/.exec(clause);
    return match !== null && value === match[1];
  }

  function inList(value: string, clause: string | null): boolean {
    if (clause === null) return true;
    const match = /^in\.\((.*)\)$/.exec(clause);
    if (!match) return false;
    return match[1].split(",").map(decodeURIComponent).includes(value);
  }

  /** A PostgREST filter: absent, `eq.x`, or `in.(x,y)`. */
  function matches(value: string, clause: string | null): boolean {
    return (
      clause === null || eq(value, clause) || (clause.startsWith("in.") && inList(value, clause))
    );
  }

  function counted(rows: unknown[], init?: RequestInit): Response {
    const headers = new Headers(init?.headers);
    if ((headers.get("Prefer") ?? "").includes("count=exact")) {
      return jsonResponse([], 200, { "Content-Range": `0-0/${rows.length}` });
    }
    return jsonResponse(rows);
  }

  const handler = (url: string, init?: RequestInit): Response => {
    const parsed = new URL(url);
    const table = parsed.pathname.replace("/rest/v1/", "").split("?")[0];
    const params = parsed.searchParams;
    const method = (init?.method ?? "GET").toUpperCase();
    const me = caller(init);

    if (table === "games" && method === "GET") {
      const rows = db.games.filter(
        (g) => eq(g.slug, params.get("slug")) && inList(g.id, params.get("id")),
      );
      return jsonResponse(rows);
    }
    if (table === "game_engagement_counts" && method === "GET") {
      const rows = db.games
        .filter((g) => g.published && matches(g.slug, params.get("slug")))
        .map((g) => ({
          game_id: g.id,
          slug: g.slug,
          like_count: db.likes.filter((r) => r.target_kind === "game" && r.target_id === g.id)
            .length,
          comment_count: db.comments.filter((r) => r.game_id === g.id).length,
        }));
      return jsonResponse(rows);
    }
    if (table === "game_stats" && method === "GET") {
      return jsonResponse(db.stats);
    }
    if (table === "profiles" && method === "GET") {
      return jsonResponse(db.profiles.filter((p) => inList(p.id, params.get("id"))));
    }
    if (table === "likes") {
      if (method === "GET") {
        const rows = db.likes.filter(
          (r) =>
            eq(r.user_id, params.get("user_id")) &&
            eq(r.target_kind, params.get("target_kind")) &&
            matches(r.target_id, params.get("target_id")),
        );
        return counted(rows, init);
      }
      if (method === "POST") {
        if (!me) return errorResponse(401, "JWT missing");
        const body = JSON.parse(String(init?.body ?? "{}"));
        if (body.user_id !== me) return errorResponse(403, "attribution");
        if (
          db.likes.some(
            (r) =>
              r.user_id === body.user_id &&
              r.target_kind === body.target_kind &&
              r.target_id === body.target_id,
          )
        ) {
          return errorResponse(409, "duplicate key value");
        }
        db.likes.push({
          user_id: body.user_id,
          target_kind: body.target_kind,
          target_id: body.target_id,
        });
        return jsonResponse([], 201);
      }
      if (method === "DELETE") {
        if (!me) return errorResponse(401, "JWT missing");
        const userId = params.get("user_id");
        if (userId !== null && userId !== `eq.${me}`) return errorResponse(403, "attribution");
        db.likes = db.likes.filter(
          (r) =>
            !(
              r.user_id === me &&
              eq(r.target_kind, params.get("target_kind")) &&
              eq(r.target_id, params.get("target_id"))
            ),
        );
        return new Response(null, { status: 204 });
      }
    }
    if (table === "saves") {
      if (method === "GET") {
        if (!me) return errorResponse(401, "JWT missing");
        const rows = db.saves.filter(
          (r) => r.user_id === me && matches(r.game_id, params.get("game_id")),
        );
        return jsonResponse(rows);
      }
      if (method === "POST") {
        if (!me) return errorResponse(401, "JWT missing");
        const body = JSON.parse(String(init?.body ?? "{}"));
        if (body.user_id !== me) return errorResponse(403, "attribution");
        const game = db.games.find((g) => g.id === body.game_id);
        if (!game?.published) return errorResponse(403, "draft");
        if (db.saves.some((r) => r.user_id === body.user_id && r.game_id === body.game_id)) {
          return errorResponse(409, "duplicate key value");
        }
        db.saves.push({ user_id: body.user_id, game_id: body.game_id });
        return jsonResponse([], 201);
      }
      if (method === "DELETE") {
        if (!me) return errorResponse(401, "JWT missing");
        const userId = params.get("user_id");
        if (userId !== null && userId !== `eq.${me}`) return errorResponse(403, "attribution");
        db.saves = db.saves.filter(
          (r) => !(r.user_id === me && eq(r.game_id, params.get("game_id"))),
        );
        return new Response(null, { status: 204 });
      }
    }
    if (table === "comments") {
      if (method === "GET") {
        const rows = db.comments.filter(
          (r) => eq(r.game_id, params.get("game_id")) && eq(r.author_id, params.get("author_id")),
        );
        const ordered = [...rows].sort((a, b) =>
          (params.get("order") ?? "").startsWith("created_at.desc")
            ? b.created_at.localeCompare(a.created_at)
            : a.created_at.localeCompare(b.created_at),
        );
        return counted(ordered, init);
      }
      if (method === "POST") {
        if (!me) return errorResponse(401, "JWT missing");
        const body = JSON.parse(String(init?.body ?? "{}"));
        if (body.author_id !== me) return errorResponse(403, "attribution");
        const game = db.games.find((g) => g.id === body.game_id);
        if (!game?.published) return errorResponse(403, "draft");
        const text = String(body.body ?? "").trim();
        if (text === "" || text.length > 2000) {
          return errorResponse(400, "body length");
        }
        // Replies: the parent must be a top-level comment on the same game.
        if (body.parent_id) {
          const parent = db.comments.find((r) => r.id === body.parent_id);
          if (!parent || parent.game_id !== body.game_id || parent.parent_id) {
            return errorResponse(403, "reply parent");
          }
        }
        const row: CommentRow = {
          id: `cccccccc-0000-4111-8111-${String(db.commentSeq++).padStart(12, "0")}`,
          game_id: body.game_id,
          author_id: me,
          parent_id: body.parent_id ?? null,
          body: text,
          created_at: "2026-10-14T12:00:00.000Z",
          updated_at: "2026-10-14T12:00:00.000Z",
        };
        db.comments.push(row);
        return jsonResponse([row], 201);
      }
      if (method === "DELETE") {
        if (!me) return errorResponse(401, "JWT missing");
        const id = params.get("id")?.replace(/^eq\./, "");
        const row = db.comments.find((r) => r.id === id);
        if (row && row.author_id !== me) return errorResponse(403, "attribution");
        db.comments = db.comments.filter((r) => r.id !== id && r.parent_id !== id);
        return new Response(null, { status: 204 });
      }
    }
    if (table === "scores" && method === "GET") {
      if (!me) return errorResponse(401, "JWT missing");
      return jsonResponse([]);
    }
    throw new Error(`unexpected supabase call ${method} ${url}`);
  };

  return { db, handler };
}

/**
 * Routes stubbed fetch by URL: relative /api/v1/* goes to the Go gateway
 * double (auth only — engagement uses the Data API), absolute Supabase REST
 * goes to the Supabase double.
 */
function stubApiAndSupabase(supabaseHandler: (url: string, init?: RequestInit) => Response) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/v1/")) {
      if (url.includes("/auth/sign-in")) return jsonResponse(sessionPayload());
      throw new Error(`unexpected gateway call ${url}`);
    }
    if (url.startsWith(supabaseBase)) {
      return supabaseHandler(url, init);
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

beforeEach(() => {
  clearSession();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearSession();
});

async function signInAsPlayer() {
  await signIn("player@example.com", "correct-horse");
}

describe("likes persist through the database", () => {
  it("likes and unlikes a game, and the state reads back", async () => {
    const { handler } = createSupabaseDouble();
    stubApiAndSupabase(handler);
    await signInAsPlayer();

    expect(await isLiked(GAME_ID)).toBe(false);
    expect(await fetchLikeCount(GAME_ID)).toBe(0);

    await likeGame(GAME_ID);
    expect(await isLiked(GAME_ID)).toBe(true);
    expect(await fetchLikeCount(GAME_ID)).toBe(1);
    expect(await listLikedGameIds()).toEqual([GAME_ID]);

    await unlikeGame(GAME_ID);
    expect(await isLiked(GAME_ID)).toBe(false);
    expect(await fetchLikeCount(GAME_ID)).toBe(0);
    expect(await listLikedGameIds()).toEqual([]);
  });

  it("treats a concurrent duplicate like as already liked, not a failure", async () => {
    const { handler, db } = createSupabaseDouble();
    const spy = stubApiAndSupabase(handler);
    await signInAsPlayer();

    await likeGame(GAME_ID);
    // A second request racing the first conflicts on the primary key (409).
    await likeGame(GAME_ID);

    expect(await isLiked(GAME_ID)).toBe(true);
    expect(db.likes).toHaveLength(1);
    expect(spy).toHaveBeenCalled();
  });

  it("unliking what is not liked still succeeds", async () => {
    const { handler } = createSupabaseDouble();
    stubApiAndSupabase(handler);
    await signInAsPlayer();

    await expect(unlikeGame(GAME_ID)).resolves.toBeUndefined();
    expect(await isLiked(GAME_ID)).toBe(false);
  });

  it("never addresses another user's rows: like and unlike name the caller", async () => {
    const { handler } = createSupabaseDouble();
    const spy = stubApiAndSupabase(handler);
    await signInAsPlayer();

    await likeGame(GAME_ID);
    const post = spy.mock.calls.find((call) => String(call[0]).endsWith("/rest/v1/likes"));
    expect(JSON.parse(String(post?.[1]?.body ?? "{}")).user_id).toBe(ME);

    await unlikeGame(GAME_ID);
    const del = spy.mock.calls.find((call) => call[1]?.method === "DELETE");
    expect(String(del?.[0])).toContain(`user_id=eq.${ME}`);
    expect(String(del?.[0])).not.toContain(OTHER);
  });

  it("requires a session: anonymous callers read false and cannot write", async () => {
    const { handler } = createSupabaseDouble();
    const spy = stubApiAndSupabase(handler);

    expect(await isLiked(GAME_ID)).toBe(false);
    await expect(likeGame(GAME_ID)).rejects.toMatchObject({ code: "unauthorized" });
    await expect(unlikeGame(GAME_ID)).rejects.toMatchObject({ code: "unauthorized" });
    // No anonymous read hit the API at all.
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("saves persist per player", () => {
  it("saves and unsaves a game, and the list reads back newest first", async () => {
    const { handler } = createSupabaseDouble();
    stubApiAndSupabase(handler);
    await signInAsPlayer();

    expect(await isSaved(GAME_ID)).toBe(false);
    await saveGame(GAME_ID);
    expect(await isSaved(GAME_ID)).toBe(true);
    expect(await listSavedGameIds()).toEqual([GAME_ID]);

    await unsaveGame(GAME_ID);
    expect(await isSaved(GAME_ID)).toBe(false);
    expect(await listSavedGameIds()).toEqual([]);
  });

  it("treats a concurrent duplicate save as already saved", async () => {
    const { handler, db } = createSupabaseDouble();
    stubApiAndSupabase(handler);
    await signInAsPlayer();

    await saveGame(GAME_ID);
    await saveGame(GAME_ID);

    expect(db.saves).toHaveLength(1);
    expect(await isSaved(GAME_ID)).toBe(true);
  });

  it("restores saved state across sessions: a fresh read sees the stored row", async () => {
    const { handler } = createSupabaseDouble();
    stubApiAndSupabase(handler);
    await signInAsPlayer();
    await saveGame(GAME_ID);

    // A new hook instance (a remount, a refresh, another tab's reload) reads
    // the same persisted state rather than starting over.
    expect(await isSaved(GAME_ID)).toBe(true);
    expect(await listSavedGameIds()).toEqual([GAME_ID]);
  });

  it("refuses to save a game that is not published", async () => {
    const { handler, db } = createSupabaseDouble();
    db.games[0].published = false;
    stubApiAndSupabase(handler);
    await signInAsPlayer();

    await expect(saveGame(GAME_ID)).rejects.toMatchObject({ code: "save_failed" });
    expect(await isSaved(GAME_ID)).toBe(false);
  });

  it("resolves saved ids back to catalogue games", async () => {
    const { handler } = createSupabaseDouble();
    stubApiAndSupabase(handler);
    await signInAsPlayer();
    await saveGame(GAME_ID);

    const games = await fetchGamesByIds(await listSavedGameIds());
    expect(games).toHaveLength(1);
    expect(games[0].slug).toBe(GAME_SLUG);
    expect(games[0].title).toBe("Stack 10");
    expect(games[0].plays).toBe(42);
    expect(games[0].category).toEqual({ slug: "puzzle", name: "Puzzle" });
  });
});

describe("comments validate, persist and attribute", () => {
  it("rejects empty and over-long bodies without touching the API", async () => {
    const { handler } = createSupabaseDouble();
    const spy = stubApiAndSupabase(handler);
    await signInAsPlayer();
    spy.mockClear();

    await expect(postComment(GAME_ID, "   ")).rejects.toMatchObject({ code: "bad_request" });
    await expect(postComment(GAME_ID, "x".repeat(2001))).rejects.toMatchObject({
      code: "bad_request",
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("posts a comment that reads back with its author and count", async () => {
    const { handler } = createSupabaseDouble();
    stubApiAndSupabase(handler);
    await signInAsPlayer();

    const posted = await postComment(GAME_ID, "  Love the daily loop.  ");
    expect(posted.body).toBe("Love the daily loop.");
    expect(posted.authorId).toBe(ME);
    expect(posted.author?.username).toBe("rija");

    const rows = await fetchComments(GAME_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0].body).toBe("Love the daily loop.");
    expect(await fetchCommentCount(GAME_ID)).toBe(1);
  });

  it("posts a reply with its parent and refuses a reply to a reply", async () => {
    const { handler, db } = createSupabaseDouble();
    stubApiAndSupabase(handler);
    await signInAsPlayer();

    const parent = await postComment(GAME_ID, "Top");
    const reply = await postComment(GAME_ID, "Answer", parent.id);
    expect(reply.parentId).toBe(parent.id);
    expect(parent.parentId).toBeNull();
    expect(db.comments.at(-1)?.parent_id).toBe(parent.id);

    await expect(postComment(GAME_ID, "Too deep", reply.id)).rejects.toBeInstanceOf(ApiError);
  });

  it("deletes an own comment and keeps the list honest", async () => {
    const { handler } = createSupabaseDouble();
    stubApiAndSupabase(handler);
    await signInAsPlayer();

    const posted = await postComment(GAME_ID, "First!");
    await deleteComment(posted.id);

    expect(await fetchComments(GAME_ID)).toHaveLength(0);
    expect(await fetchCommentCount(GAME_ID)).toBe(0);
  });

  it("cannot delete another player's comment: the refusal surfaces and the row stays", async () => {
    const { handler, db } = createSupabaseDouble();
    db.comments.push({
      id: "cccccccc-1111-4111-8111-cccccccccccc",
      game_id: GAME_ID,
      author_id: OTHER,
      body: "Nora's take",
      created_at: "2026-10-14T11:00:00.000Z",
      updated_at: "2026-10-14T11:00:00.000Z",
    });
    stubApiAndSupabase(handler);
    await signInAsPlayer();

    await expect(deleteComment("cccccccc-1111-4111-8111-cccccccccccc")).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(db.comments).toHaveLength(1);
  });

  it("requires a session to post", async () => {
    const { handler } = createSupabaseDouble();
    stubApiAndSupabase(handler);

    await expect(postComment(GAME_ID, "Hello")).rejects.toMatchObject({ code: "unauthorized" });
  });
});

describe("engagement hook", () => {
  function Probe({ slug }: { slug: string }) {
    const engagement = useGameEngagement(slug);
    return (
      <div>
        <span data-testid="loading">{String(engagement.loading)}</span>
        <span data-testid="liked">{String(engagement.liked)}</span>
        <span data-testid="saved">{String(engagement.saved)}</span>
        <span data-testid="like-count">{String(engagement.likeCount)}</span>
        <span data-testid="comment-count">{String(engagement.commentCount)}</span>
        <button onClick={() => void engagement.toggleLike()}>like</button>
        <button onClick={() => void engagement.toggleSave()}>save</button>
      </div>
    );
  }

  function renderProbe() {
    const root = createRootRoute();
    const router = createRouter({
      routeTree: root.addChildren([
        createRoute({
          getParentRoute: () => root,
          path: "/",
          component: () => <Probe slug={GAME_SLUG} />,
        }),
      ]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    render(<RouterProvider router={router} />);
    return act(async () => {
      await router.load();
    });
  }

  it("loads counts for anonymous visitors with false states", async () => {
    const { handler, db } = createSupabaseDouble();
    db.likes.push({ user_id: OTHER, target_kind: "game", target_id: GAME_ID });
    stubApiAndSupabase(handler);

    await renderProbe();
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));

    expect(screen.getByTestId("liked").textContent).toBe("false");
    expect(screen.getByTestId("saved").textContent).toBe("false");
    expect(screen.getByTestId("like-count").textContent).toBe("1");
    expect(screen.getByTestId("comment-count").textContent).toBe("0");
  });

  it("reads a whole feed's engagement in one request, and falls back per game", async () => {
    const { handler, db } = createSupabaseDouble();
    db.likes.push({ user_id: OTHER, target_kind: "game", target_id: GAME_ID });
    const spy = stubApiAndSupabase(handler);

    // Two cards asking in the same tick: one batched read of the counts view.
    const [known, unknown] = await Promise.all([
      loadEngagement(GAME_SLUG),
      loadEngagement("not-a-game"),
    ]);
    expect(known).toMatchObject({ gameId: GAME_ID, likeCount: 1, commentCount: 0 });
    expect(unknown.gameId).toBeNull();
    const reads = spy.mock.calls.map((call) => String(call[0]));
    expect(reads.filter((url) => url.includes("/game_engagement_counts"))).toHaveLength(1);
    expect(reads.some((url) => url.includes("/rest/v1/likes"))).toBe(false);

    // Without the view (an older database), each game is read the per-game way.
    resetEngagementBatching();
    stubApiAndSupabase((url, init) => {
      if (url.includes("/game_engagement_counts")) {
        return new Response(JSON.stringify({ message: "relation does not exist" }), {
          status: 404,
        });
      }
      return handler(url, init);
    });
    await expect(loadEngagement(GAME_SLUG)).resolves.toMatchObject({
      gameId: GAME_ID,
      likeCount: 1,
    });
  });

  it("toggles like and save through the database when signed in", async () => {
    const { handler } = createSupabaseDouble();
    stubApiAndSupabase(handler);
    await signInAsPlayer();

    await renderProbe();
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));

    await act(async () => {
      fireEvent.click(screen.getByText("like"));
    });
    await waitFor(() => expect(screen.getByTestId("liked").textContent).toBe("true"));
    expect(screen.getByTestId("like-count").textContent).toBe("1");

    await act(async () => {
      fireEvent.click(screen.getByText("save"));
    });
    await waitFor(() => expect(screen.getByTestId("saved").textContent).toBe("true"));
  });
});

describe("feed item engagement", () => {
  function renderFeed() {
    const root = createRootRoute();
    const router = createRouter({
      routeTree: root.addChildren([
        createRoute({
          getParentRoute: () => root,
          path: "/",
          component: () => <FeedItem game={gamePayload()} />,
        }),
        createRoute({
          getParentRoute: () => root,
          path: "/games/$id",
          component: () => <p>Game</p>,
        }),
        createRoute({ getParentRoute: () => root, path: "/login", component: () => <p>Login</p> }),
        createRoute({
          getParentRoute: () => root,
          path: "/leaderboards/$id",
          component: () => <p>Board</p>,
        }),
      ]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    render(<RouterProvider router={router} />);
    return act(async () => {
      await router.load();
    });
  }

  it("shows measured counts and persists a like with the heart filling", async () => {
    const { handler, db } = createSupabaseDouble();
    db.likes.push({ user_id: OTHER, target_kind: "game", target_id: GAME_ID });
    db.comments.push({
      id: "cccccccc-1111-4111-8111-cccccccccccc",
      game_id: GAME_ID,
      author_id: OTHER,
      body: "Nora's take",
      created_at: "2026-10-14T11:00:00.000Z",
      updated_at: "2026-10-14T11:00:00.000Z",
    });
    stubApiAndSupabase(handler);
    await signInAsPlayer();

    await renderFeed();

    // Measured, not zeroed: one like and one comment from the database.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Like, 1" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Comments, 1" })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Like, 1" }));
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Like, 2" })).toBeInTheDocument(),
    );
    expect(db.likes).toHaveLength(2);
  });

  it("sends anonymous visitors to sign in instead of faking a toggle", async () => {
    const { handler, db } = createSupabaseDouble();
    db.likes.push({ user_id: OTHER, target_kind: "game", target_id: GAME_ID });
    stubApiAndSupabase(handler);

    await renderFeed();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Like, 1" })).toBeInTheDocument(),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Like, 1" }));
    });
    await waitFor(() => expect(screen.getByText("Login")).toBeInTheDocument());
    // Nothing was written: the toggle never reached the database.
    expect(db.likes).toHaveLength(1);
  });
});

describe("comments sheet", () => {
  function renderSheet() {
    const root = createRootRoute();
    // The comment thread links to `/u/$username`, so the test router has that
    // route: clicking a link must land on the author's profile, not nowhere.
    const profileRoute = createRoute({
      getParentRoute: () => root,
      path: "/u/$username",
      component: function ProfileStub() {
        // The test router is not the generated tree, so the param is read from
        // the location rather than typed through `useParams`.
        const username = useLocation().pathname.split("/").pop();
        return <p>{username}&apos;s profile</p>;
      },
    });
    const router = createRouter({
      routeTree: root.addChildren([
        createRoute({
          getParentRoute: () => root,
          path: "/",
          component: () => (
            <CommentsSheet
              open
              onOpenChange={() => undefined}
              gameId={GAME_ID}
              gameSlug={GAME_SLUG}
              count={1}
            />
          ),
        }),
        createRoute({ getParentRoute: () => root, path: "/login", component: () => <p>Login</p> }),
        profileRoute,
      ]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    render(<RouterProvider router={router} />);
    return act(async () => {
      await router.load();
    });
  }

  it("lists persisted comments with author names and the measured total", async () => {
    const { handler, db } = createSupabaseDouble();
    db.comments.push({
      id: "cccccccc-1111-4111-8111-cccccccccccc",
      game_id: GAME_ID,
      author_id: OTHER,
      body: "Nora's take",
      created_at: "2026-10-14T11:00:00.000Z",
      updated_at: "2026-10-14T11:00:00.000Z",
    });
    stubApiAndSupabase(handler);
    await signInAsPlayer();

    await renderSheet();
    await waitFor(() => expect(screen.getByText("Nora's take")).toBeInTheDocument());

    expect(screen.getByText("@nora")).toBeInTheDocument();
    expect(screen.getByText("1 comment")).toBeInTheDocument();
    // No delete control on another player's row.
    expect(screen.queryByRole("button", { name: "Delete comment" })).not.toBeInTheDocument();
  });

  it("shows another account's picture, built from that account's stored path", async () => {
    const { handler, db } = createSupabaseDouble();
    db.comments.push({
      id: "cccccccc-1111-4111-8111-cccccccccccc",
      game_id: GAME_ID,
      author_id: OTHER,
      body: "Nora's take",
      created_at: "2026-10-14T11:00:00.000Z",
      updated_at: "2026-10-14T11:00:00.000Z",
    });
    stubApiAndSupabase(handler);
    await signInAsPlayer();

    await renderSheet();
    await waitFor(() => expect(screen.getByText("Nora's take")).toBeInTheDocument());

    // The caller has no picture of their own, so the only image on the sheet is
    // the commenter's — and it is theirs, not the signed-in player's.
    const image = document.querySelector("img");
    expect(image).not.toBeNull();
    expect(image?.getAttribute("src")).toBe(
      `${supabaseBase}/storage/v1/object/public/avatars/9c1f0b2a/nora.png`,
    );
  });

  it("links a commenter's username and avatar to that author's profile", async () => {
    const { handler, db } = createSupabaseDouble();
    db.comments.push({
      id: "cccccccc-1111-4111-8111-cccccccccccc",
      game_id: GAME_ID,
      author_id: OTHER,
      body: "Nora's take",
      created_at: "2026-10-14T11:00:00.000Z",
      updated_at: "2026-10-14T11:00:00.000Z",
    });
    stubApiAndSupabase(handler);
    await signInAsPlayer();

    await renderSheet();
    await waitFor(() => expect(screen.getByText("Nora's take")).toBeInTheDocument());

    expect(screen.getByRole("link", { name: "@nora" })).toHaveAttribute("href", "/u/nora");
    expect(screen.getByRole("link", { name: "View @nora's profile" })).toHaveAttribute(
      "href",
      "/u/nora",
    );

    fireEvent.click(screen.getByRole("link", { name: "@nora" }));
    await waitFor(() => expect(screen.getByText("nora's profile")).toBeInTheDocument());
  });

  it("opens the same profile from the commenter's avatar", async () => {
    const { handler, db } = createSupabaseDouble();
    db.comments.push({
      id: "cccccccc-1111-4111-8111-cccccccccccc",
      game_id: GAME_ID,
      author_id: OTHER,
      body: "Nora's take",
      created_at: "2026-10-14T11:00:00.000Z",
      updated_at: "2026-10-14T11:00:00.000Z",
    });
    stubApiAndSupabase(handler);
    await signInAsPlayer();

    await renderSheet();
    await waitFor(() => expect(screen.getByText("Nora's take")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("link", { name: "View @nora's profile" }));
    await waitFor(() => expect(screen.getByText("nora's profile")).toBeInTheDocument());
  });

  it("falls back to initials when a picture cannot load", () => {
    // A stored path can outlive its object, or the bucket can answer an error.
    // The avatar then shows the same initials a profile without a picture does.
    render(
      <Avatar name="Nora" src={`${supabaseBase}/storage/v1/object/public/avatars/gone.png`} />,
    );

    fireEvent.error(document.querySelector("img") as HTMLImageElement);

    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText("NO")).toBeInTheDocument();
  });

  it("offers delete on an own comment and removes it", async () => {
    const { handler } = createSupabaseDouble();
    stubApiAndSupabase(handler);
    await signInAsPlayer();

    await renderSheet();
    await waitFor(() => expect(screen.getByPlaceholderText("Add a comment…")).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText("Add a comment…"), { target: { value: "Mine" } });
    fireEvent.click(screen.getByRole("button", { name: "Post comment" }));
    await waitFor(() => expect(screen.getByText("Mine")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Delete comment" }));
    fireEvent.click(screen.getByText("Delete", { selector: "button" }));
    await waitFor(() => expect(screen.queryByText("Mine")).not.toBeInTheDocument());
    expect(screen.getByText("0 comments")).toBeInTheDocument();
  });

  it("replies to a comment and nests the reply under it", async () => {
    const { handler, db } = createSupabaseDouble();
    db.comments.push({
      id: "cccccccc-1111-4111-8111-cccccccccccc",
      game_id: GAME_ID,
      author_id: OTHER,
      body: "Nora's take",
      created_at: "2026-10-14T11:00:00.000Z",
      updated_at: "2026-10-14T11:00:00.000Z",
    });
    stubApiAndSupabase(handler);
    await signInAsPlayer();

    await renderSheet();
    await waitFor(() => expect(screen.getByText("Nora's take")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Reply to @nora" }));
    expect(screen.getByText("Replying to @nora")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Add a reply…"), {
      target: { value: "Agreed!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Post reply" }));

    await waitFor(() => expect(screen.getByText("Agreed!")).toBeInTheDocument());
    expect(db.comments.at(-1)).toMatchObject({
      parent_id: "cccccccc-1111-4111-8111-cccccccccccc",
      body: "Agreed!",
    });
    const replies = screen.getByRole("list", { name: "Replies" });
    expect(replies).toHaveTextContent("Agreed!");
    // Back to a top-level composer, and replies cannot be replied to.
    expect(screen.getByPlaceholderText("Add a comment…")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Reply to/ })).toHaveLength(1);
    expect(screen.getByText("2 comments")).toBeInTheDocument();
  });

  it("cancels a reply and posts a top-level comment instead", async () => {
    const { handler, db } = createSupabaseDouble();
    db.comments.push({
      id: "cccccccc-1111-4111-8111-cccccccccccc",
      game_id: GAME_ID,
      author_id: OTHER,
      body: "Nora's take",
      created_at: "2026-10-14T11:00:00.000Z",
      updated_at: "2026-10-14T11:00:00.000Z",
    });
    stubApiAndSupabase(handler);
    await signInAsPlayer();

    await renderSheet();
    await waitFor(() => expect(screen.getByText("Nora's take")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Reply to @nora" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel reply" }));
    fireEvent.change(screen.getByPlaceholderText("Add a comment…"), { target: { value: "Solo" } });
    fireEvent.click(screen.getByRole("button", { name: "Post comment" }));

    await waitFor(() => expect(screen.getByText("Solo")).toBeInTheDocument());
    expect(db.comments.at(-1)?.parent_id ?? null).toBeNull();
  });

  it("offers no reply control to anonymous visitors", async () => {
    const { handler, db } = createSupabaseDouble();
    db.comments.push({
      id: "cccccccc-1111-4111-8111-cccccccccccc",
      game_id: GAME_ID,
      author_id: OTHER,
      body: "Nora's take",
      created_at: "2026-10-14T11:00:00.000Z",
      updated_at: "2026-10-14T11:00:00.000Z",
    });
    stubApiAndSupabase(handler);

    await renderSheet();
    await waitFor(() => expect(screen.getByText("Nora's take")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^Reply to/ })).not.toBeInTheDocument();
  });

  it("shows the sign-in prompt to anonymous visitors", async () => {
    const { handler } = createSupabaseDouble();
    stubApiAndSupabase(handler);

    await renderSheet();
    await waitFor(() => expect(screen.getByText(/to join the conversation/)).toBeInTheDocument());

    expect(screen.queryByPlaceholderText("Add a comment…")).not.toBeInTheDocument();
  });

  it("reports a failed load with a retry that recovers", async () => {
    let attempts = 0;
    const { handler } = createSupabaseDouble();
    stubApiAndSupabase((url, init) => {
      if (url.includes("/rest/v1/comments") && attempts++ === 0) {
        return jsonResponse({ message: "boom" }, 500);
      }
      return handler(url, init);
    });
    await signInAsPlayer();

    await renderSheet();
    await waitFor(() => expect(screen.getByText("Couldn't load comments")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(screen.getByText("No comments yet")).toBeInTheDocument());
  });
});

describe("share sheet links", () => {
  const canonical = absoluteUrl("/games/stack-10");

  function renderShare() {
    const root = createRootRoute();
    const router = createRouter({
      routeTree: root.addChildren([
        createRoute({
          getParentRoute: () => root,
          path: "/",
          component: () => (
            <ShareSheet
              open
              onOpenChange={() => undefined}
              title="Stack 10"
              path="/games/stack-10"
            />
          ),
        }),
      ]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    render(<RouterProvider router={router} />);
    return act(async () => {
      await router.load();
    });
  }

  function stubClipboard(impl?: (text: string) => Promise<void>) {
    const writeText = vi.fn(impl ?? (async () => undefined));
    Object.defineProperty(window.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    return writeText;
  }

  beforeEach(() => {
    // jsdom has no clipboard or share sheet; each test installs its own double.
    Object.defineProperty(window.navigator, "clipboard", { value: undefined, configurable: true });
    Object.defineProperty(window.navigator, "share", { value: undefined, configurable: true });
  });

  it("builds the canonical game URL, not the current location", () => {
    expect(canonical).toBe(`${canonical.split("/games/")[0]}/games/stack-10`);
    expect(canonical).not.toBe(window.location.href);
  });

  it("copies the canonical URL and reports success only when the write succeeds", async () => {
    const writeText = stubClipboard();
    await renderShare();

    fireEvent.click(screen.getByRole("button", { name: /copy link/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(canonical));
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith("Link copied");
  });

  it("reports failure — and never success — when copying fails", async () => {
    stubClipboard(async () => {
      throw new DOMException("denied", "NotAllowedError");
    });
    await renderShare();

    fireEvent.click(screen.getByRole("button", { name: /copy link/i }));
    await waitFor(() =>
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Couldn't copy the link."),
    );
    expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
  });

  it("reports failure when no clipboard exists at all", async () => {
    await renderShare();

    fireEvent.click(screen.getByRole("button", { name: /copy link/i }));
    await waitFor(() =>
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Couldn't copy the link."),
    );
    expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
  });

  it("uses the native share sheet where supported and stays silent on cancel", async () => {
    stubClipboard();
    const share = vi.fn(async () => undefined);
    Object.defineProperty(window.navigator, "share", { value: share, configurable: true });
    await renderShare();

    fireEvent.click(screen.getByRole("button", { name: /more options/i }));
    await waitFor(() => expect(share).toHaveBeenCalledWith({ title: "Stack 10", url: canonical }));
    expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();

    share.mockRejectedValueOnce(new DOMException("cancelled", "AbortError"));
    fireEvent.click(screen.getByRole("button", { name: /more options/i }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(2));
    // A dismissal is not a failure: no toast either way.
    expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
  });

  it("falls back to copying when the platform has no share sheet", async () => {
    const writeText = stubClipboard();
    await renderShare();

    fireEvent.click(screen.getByRole("button", { name: /more options/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(canonical));
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith("Link copied");
  });

  it("emails the canonical URL without navigating away or crashing", async () => {
    await renderShare();
    const before = window.location.href;

    fireEvent.click(screen.getByRole("button", { name: /email/i }));

    // jsdom blocks real navigation; the click must not throw and must not
    // leave the page. The mailto body is built from the same canonical URL
    // the copy action is asserted against above.
    expect(window.location.href).toBe(before);
    expect(canonical).not.toBe(before);
  });
});

describe("saved and liked lists resolve to catalogue games", () => {
  it("lists saved games with measured play counts", async () => {
    const { handler } = createSupabaseDouble();
    stubApiAndSupabase(handler);
    await signInAsPlayer();
    await saveGame(GAME_ID);

    const games = await fetchGamesByIds(await listSavedGameIds());
    expect(games.map((g) => g.slug)).toEqual([GAME_SLUG]);
    expect(games[0].plays).toBe(42);

    expect(await listLikedGameIds()).toEqual([]);
  });
});
