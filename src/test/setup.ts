import "@testing-library/jest-dom/vitest";

import { levelUpTiming } from "@/lib/games/level-up";

// The beat between two levels runs on a real clock. The play tests solve level
// after level in one go, so it is off by default; the level-up tests turn it on.
beforeEach(() => {
  levelUpTiming.ms = 0;
  levelUpTiming.noteMs = 0;
});

// The query cache and the engagement batcher are app-wide singletons. Each test
// starts from an empty cache so one test's answers are never another's. Imported
// lazily: a static import would load the app's config before the env stubs
// below are in place.
afterEach(async () => {
  const [{ getQueryClient }, { resetEngagementBatching }] = await Promise.all([
    import("@/lib/query"),
    import("@/lib/social/engagement"),
  ]);
  getQueryClient().clear();
  resetEngagementBatching();
});

// Public configuration has to be deterministic: a local `.env.local` is not
// present on a fresh checkout or in CI, and code that builds a Supabase URL (an
// avatar, for instance) needs a value a test can assert against.
vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test_value");

Object.defineProperty(window, "scrollTo", {
  writable: true,
  value: () => {},
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
