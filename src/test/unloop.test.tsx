import { QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UnloopViewer } from "@/components/unloop/UnloopViewer";
import { clearSession, signIn } from "@/lib/auth/session";
import { contentSecurityPolicy } from "@/lib/csp";
import { getQueryClient } from "@/lib/query";
import { fetchUnloopPage, unloopFileUrl } from "@/lib/unloop/feed";
import { storageUploadError } from "@/lib/unloop/admin";
import { Route as UnloopAdminRoute } from "@/routes/admin.unloop";

const viewerId = "3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f";
const loopA = "6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const loopB = "7a2d3c4b-5e6f-4a71-9b8c-0d1e2f3a4b5c";

function row(id: string, title: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    title,
    description: "A clean run",
    category: "highlights",
    video_path: `videos/${id}.mp4`,
    thumbnail_path: `thumbnails/${id}.jpg`,
    duration_seconds: "12.50",
    published_at: "2027-01-23T12:00:00Z",
    likes: 3,
    saves: "1",
    liked: false,
    saved: false,
    ...extra,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Handler = (url: string, init?: RequestInit) => Response | undefined;

function stubFetch(handler: Handler) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/auth/sign-in")) {
      return jsonResponse({
        session: { userId: viewerId, role: "user", email: "p@example.com", onboarded: true },
        tokens: {
          accessToken: "access-token-1",
          refreshToken: "refresh-token-1",
          tokenType: "bearer",
          expiresIn: 3600,
        },
      });
    }
    return handler(url, init) ?? jsonResponse([]);
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

async function renderAt(component: () => ReactElement, path = "/") {
  const root = createRootRoute();
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: "/", component }),
      createRoute({
        getParentRoute: () => root,
        path: "/login",
        component: () => <p>login page</p>,
      }),
      createRoute({ getParentRoute: () => root, path: "/unloop", component: () => <p>unloop</p> }),
    ]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <QueryClientProvider client={getQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await act(async () => {
    await router.load();
  });
  return router;
}

beforeEach(() => {
  clearSession();
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Unloop viewer", () => {
  it("shows published loops with the counts the database measured", async () => {
    const spy = stubFetch((url) =>
      url.includes("rpc/unloop_feed") ? jsonResponse([row(loopA, "First loop")]) : undefined,
    );
    await renderAt(() => <UnloopViewer channel="all" onChannel={() => {}} />);

    const slide = await screen.findByRole("article", { name: "First loop" });
    expect(within(slide).getByRole("button", { name: "Like, 3" })).toBeInTheDocument();
    expect(within(slide).getByRole("button", { name: "Save, 1" })).toBeInTheDocument();
    expect(slide.querySelector("video")?.getAttribute("src")).toBe(
      unloopFileUrl(`videos/${loopA}.mp4`),
    );
    // A guest reads the feed with the publishable key only.
    const feedCall = spy.mock.calls.find(([url]) => String(url).includes("rpc/unloop_feed"));
    const headers = (feedCall?.[1]?.headers ?? {}) as Record<string, string>;
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("sends a guest who likes a loop to sign in, and writes nothing", async () => {
    const spy = stubFetch((url) =>
      url.includes("rpc/unloop_feed") ? jsonResponse([row(loopA, "First loop")]) : undefined,
    );
    await renderAt(() => <UnloopViewer channel="all" onChannel={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "Like, 3" }));
    expect(await screen.findByText("login page")).toBeInTheDocument();
    expect(spy.mock.calls.some(([url]) => String(url).includes("unloop_likes"))).toBe(false);
  });

  it("likes for the signed-in viewer at once, and takes it back when refused", async () => {
    let refuse = false;
    const spy = stubFetch((url, init) => {
      if (url.includes("rpc/unloop_feed")) return jsonResponse([row(loopA, "First loop")]);
      if (url.includes("/rest/v1/unloop_likes") && init?.method === "POST") {
        return refuse ? jsonResponse({ code: "42501" }, 403) : jsonResponse(null, 201);
      }
      return undefined;
    });
    await signIn("p@example.com", "correct-horse");
    await renderAt(() => <UnloopViewer channel="all" onChannel={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "Like, 3" }));
    expect(await screen.findByRole("button", { name: "Unlike, 4" })).toBeInTheDocument();
    const write = spy.mock.calls.find(
      ([url, init]) => String(url).includes("/rest/v1/unloop_likes") && init?.method === "POST",
    );
    expect(JSON.parse(String(write?.[1]?.body))).toEqual({ user_id: viewerId, video_id: loopA });

    // Unlike, then a refused like: the count goes back to what it was.
    spy.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Unlike, 4" }));
    await screen.findByRole("button", { name: "Like, 3" });
    refuse = true;
    fireEvent.click(screen.getByRole("button", { name: "Like, 3" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Like, 3" })).toHaveAttribute(
        "aria-pressed",
        "false",
      ),
    );
  });

  it("says so when a channel has nothing yet, and offers every loop", async () => {
    stubFetch(() => jsonResponse([]));
    const onChannel = vi.fn();
    await renderAt(() => <UnloopViewer channel="speedruns" onChannel={onChannel} />);

    expect(await screen.findByText("Nothing's looping here yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Watch all loops" }));
    expect(onChannel).toHaveBeenCalledWith("all");
  });

  it("asks a guest to sign in for saved loops without reading anything", async () => {
    const spy = stubFetch(() => jsonResponse([]));
    await renderAt(() => <UnloopViewer channel="saved" onChannel={() => {}} />);

    expect(await screen.findByText("Your saved loops live here")).toBeInTheDocument();
    expect(spy.mock.calls.some(([url]) => String(url).includes("rpc/unloop_feed"))).toBe(false);
  });
});

describe("Unloop feed", () => {
  it("opens a shared loop first and does not repeat it", async () => {
    stubFetch((url) => {
      if (url.includes(`p_video=${loopB}`)) return jsonResponse([row(loopB, "Shared loop")]);
      if (url.includes("rpc/unloop_feed"))
        return jsonResponse([row(loopA, "First loop"), row(loopB, "Shared loop")]);
      return undefined;
    });
    await renderAt(() => <UnloopViewer channel="all" first={loopB} onChannel={() => {}} />);

    await screen.findByRole("article", { name: "Shared loop" });
    const titles = screen.getAllByRole("article").map((el) => el.getAttribute("aria-label"));
    expect(titles).toEqual(["Shared loop", "First loop"]);
  });

  it("asks the database for one channel and maps its numbers", async () => {
    const spy = stubFetch(() => jsonResponse([row(loopA, "First loop")]));
    const [video] = await fetchUnloopPage({ category: "how-to", offset: 8 });
    const url = String(spy.mock.calls[0]?.[0]);
    expect(url).toContain("/rest/v1/rpc/unloop_feed?");
    expect(url).toContain("p_category=how-to");
    expect(url).toContain("p_offset=8");
    expect(video).toMatchObject({ likes: 3, saves: 1, durationSeconds: 12.5 });
  });
});

describe("Unloop and the platform", () => {
  it("lets videos stream from storage under the content security policy", () => {
    expect(contentSecurityPolicy("n")).toContain(
      "media-src 'self' blob: https://project.supabase.co",
    );
  });
});

describe("Unloop studio", () => {
  function adminApi(isAdmin: boolean, items: unknown[] = []) {
    return stubFetch((url) => {
      if (url.includes("/admin/session")) {
        return jsonResponse({
          userId: viewerId,
          username: "rijad",
          displayName: "Rijad",
          role: isAdmin ? "admin" : "moderator",
          isStaff: true,
          isAdmin,
          isSuspended: false,
        });
      }
      if (url.includes("/admin/unloop/videos")) return jsonResponse({ items, hasMore: false });
      return undefined;
    });
  }

  it("is closed to anyone but an administrator", async () => {
    const spy = adminApi(false);
    await signIn("p@example.com", "correct-horse");
    await renderAt(UnloopAdminRoute.options.component as () => ReactElement);

    expect(
      await screen.findByText("Publishing Unloop videos requires an administrator."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Publish/ })).toBeNull();
    expect(spy.mock.calls.some(([url]) => String(url).includes("/admin/unloop/uploads"))).toBe(
      false,
    );
  });

  it("lists the library with each loop's state and numbers", async () => {
    adminApi(true, [
      {
        id: loopA,
        title: "First loop",
        description: "",
        category: "speedruns",
        videoPath: `videos/${loopA}.mp4`,
        thumbnailPath: null,
        durationSeconds: 12,
        status: "published",
        createdByUsername: "rijad",
        createdAt: "2027-01-23T12:00:00Z",
        updatedAt: "2027-01-23T12:00:00Z",
        publishedAt: "2027-01-23T12:00:00Z",
        likes: 7,
        saves: 2,
      },
      {
        id: loopB,
        title: "Work in progress",
        description: "",
        category: "how-to",
        videoPath: `videos/${loopB}.mp4`,
        thumbnailPath: null,
        durationSeconds: null,
        status: "draft",
        createdByUsername: "rijad",
        createdAt: "2027-01-23T12:00:00Z",
        updatedAt: "2027-01-23T12:00:00Z",
        publishedAt: null,
        likes: 0,
        saves: 0,
      },
    ]);
    await signIn("p@example.com", "correct-horse");
    await renderAt(UnloopAdminRoute.options.component as () => ReactElement);

    expect(await screen.findByText("First loop")).toBeInTheDocument();
    expect(screen.getByText("Work in progress")).toBeInTheDocument();
    expect(screen.getByText("7 likes · 2 saves")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unpublish" })).toBeInTheDocument();
    // Nothing to publish until a video is uploaded.
    const composer = screen.getByText("Upload a video to continue.").closest("form")!;
    expect(within(composer).getByRole("button", { name: "Publish" })).toBeDisabled();
    expect(screen.getByText("Upload a video to continue.")).toBeInTheDocument();
  });
});

describe("Unloop uploads", () => {
  it("reads Storage's real reason out of a 400", () => {
    expect(
      storageUploadError(
        400,
        JSON.stringify({
          statusCode: "413",
          error: "Payload too large",
          message: "The object exceeded the maximum allowed size",
        }),
      ).code,
    ).toBe("too_large");
    expect(
      storageUploadError(400, JSON.stringify({ statusCode: "415", error: "invalid_mime_type" }))
        .code,
    ).toBe("unsupported_type");
    expect(
      storageUploadError(
        400,
        JSON.stringify({ statusCode: "400", error: "InvalidJWT", message: "jwt expired" }),
      ).code,
    ).toBe("upload_expired");
    const other = storageUploadError(
      400,
      JSON.stringify({ statusCode: "400", error: "Something new" }),
    );
    expect(other.message).toContain("Something new");
    expect(storageUploadError(500, "<html>").code).toBe("upload_failed");
  });
});

describe("Unloop overlay", () => {
  it("shows one line of description with more, and opens it on request", async () => {
    stubFetch((url) =>
      url.includes("rpc/unloop_feed")
        ? jsonResponse([row(loopA, "First loop", { description: "A long story ".repeat(40) })])
        : undefined,
    );
    await renderAt(() => <UnloopViewer channel="all" onChannel={() => {}} />);

    const slide = await screen.findByRole("article", { name: "First loop" });
    fireEvent.click(within(slide).getByRole("button", { name: "more" }));
    expect(within(slide).getByRole("button", { name: "less" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    fireEvent.click(within(slide).getByRole("button", { name: "less" }));
    expect(within(slide).getByRole("button", { name: "more" })).toBeInTheDocument();
  });

  it("clears the display down to the picture, and a tap brings it back", async () => {
    stubFetch((url) =>
      url.includes("rpc/unloop_feed") ? jsonResponse([row(loopA, "First loop")]) : undefined,
    );
    await renderAt(() => <UnloopViewer channel="all" onChannel={() => {}} />);

    const slide = await screen.findByRole("article", { name: "First loop" });
    fireEvent.click(within(slide).getByRole("button", { name: "Clear display" }));
    expect(document.documentElement.dataset["unloopClear"]).toBe("");
    expect(within(slide).queryByRole("button", { name: "Like, 3" })).toBeNull();

    fireEvent.pointerDown(within(slide).getByRole("button", { name: "Show controls" }));
    fireEvent.pointerUp(within(slide).getByRole("button", { name: "Show controls" }));
    await waitFor(() =>
      expect(within(slide).getByRole("button", { name: "Like, 3" })).toBeInTheDocument(),
    );
    expect(document.documentElement.dataset["unloopClear"]).toBeUndefined();
  });
});
