import { createFileRoute, Link } from "@tanstack/react-router";
import { Mail } from "lucide-react";

import { Page, PageHeader } from "@/components/common";
import { OPERATOR } from "@/components/legal";
import { Button } from "@/components/ui/button";
import { seo } from "@/lib/seo";
import { t } from "@/lib/settings/language";

/**
 * Who runs Unbored, what it is, and how to reach us: the page a visitor (or an
 * ad reviewer) looks for to see that a real person stands behind the site. The
 * body is in English for now, like the game guides.
 */
export const Route = createFileRoute("/about")({
  head: () =>
    seo(t("About Unbored"), t("Who makes Unbored, what you can play here, and how to reach us.")),
  component: About,
});

const CATEGORIES = [
  ["logic", "Logic", "Grid puzzles with one answer, solved by deduction alone."],
  ["puzzle", "Puzzle", "Sorting, sliding, merging and chain-reaction boards."],
  ["word", "Word", "A daily crossword, word hunts and letter games."],
  ["daily", "Daily", "One challenge a day, the same for everyone, new at midnight."],
  ["arcade", "Arcade", "Reflex games where one slip ends the run."],
  ["memory", "Memory", "See a pattern once, then rebuild it."],
] as const;

function About() {
  return (
    <Page>
      <PageHeader back title={t("About Unbored")} />
      <article className="space-y-8 px-4 pb-12 text-sm leading-relaxed md:px-0">
        <section>
          <p className="text-base">
            Unbored is a collection of short games you can play in your browser, on any phone,
            tablet or computer, with nothing to install. Every game is made for a few spare minutes:
            open one, play a round, and see how your score compares.
          </p>
          <p className="mt-3 text-muted-foreground">
            The games are our own. Each one is designed, written and built for Unbored — the
            puzzles, the rules, the daily crossword clues and the scoring — and each game page
            explains how it works and how to get better at it.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">What you can play</h2>
          <ul className="mt-3 space-y-2">
            {CATEGORIES.map(([slug, name, text]) => (
              <li key={slug}>
                <Link
                  to="/categories/$slug"
                  params={{ slug }}
                  className="font-medium text-foreground hover:underline"
                >
                  {name}
                </Link>
                <span className="text-muted-foreground"> — {text}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-muted-foreground">
            Or browse everything on the{" "}
            <Link to="/explore" className="underline">
              Explore
            </Link>{" "}
            page.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">Daily puzzles</h2>
          <p className="mt-2 text-muted-foreground">
            Many games have a daily edition: one word, one crossword, one case or one course a day,
            the same for every player. A new one arrives at midnight in your own time zone, and your
            first play of the day is the one that counts on the leaderboard, so everyone competes on
            equal terms.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">Scores and leaderboards</h2>
          <p className="mt-2 text-muted-foreground">
            Every game keeps score, and the{" "}
            <Link to="/leaderboards" className="underline">
              leaderboards
            </Link>{" "}
            show the best runs. You can play without an account; creating a free one keeps your
            scores, streaks and stats, and lets you follow friends, comment on games and see how you
            rank.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">Languages</h2>
          <p className="mt-2 text-muted-foreground">
            Unbored is available in English and Albanian. Some games have their own Albanian
            editions — the daily word game, for example, uses Albanian words in Albanian.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">Who makes Unbored</h2>
          <p className="mt-2 text-muted-foreground">
            Unbored is made and run by {OPERATOR.name}, in the {OPERATOR.country}. It is free to
            play and is supported by advertising. New games and daily puzzles are added regularly.
          </p>
        </section>

        <section className="rounded-xl bg-surface p-5">
          <h2 className="text-base font-semibold">Contact</h2>
          <p className="mt-1 text-muted-foreground">
            Questions, ideas for a game, a bug, or anything about your account or data: email us and
            a person will reply. Answers to common questions are on the{" "}
            <Link to="/support" className="underline">
              Support
            </Link>{" "}
            page.
          </p>
          <Button asChild size="lg" className="mt-4 w-full md:w-auto">
            <a href={`mailto:${OPERATOR.email}`}>
              <Mail />
              {OPERATOR.email}
            </a>
          </Button>
        </section>

        <p className="text-xs text-muted-foreground">
          <Link to="/privacy" className="underline">
            {t("Privacy Policy")}
          </Link>{" "}
          ·{" "}
          <Link to="/terms" className="underline">
            {t("Terms & Conditions")}
          </Link>
        </p>
      </article>
    </Page>
  );
}
