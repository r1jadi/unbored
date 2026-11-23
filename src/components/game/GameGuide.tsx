import { RulesList } from "@/components/game/RulesList";
import { guideFor } from "@/lib/games/guides";
import { rulesFor } from "@/lib/games/rules";
import { currentLanguage, t } from "@/lib/settings/language";

/**
 * Everything a game's page says about the game: the full rules (the same ones
 * its rules screen shows), then the written guide — what it is, tips, and
 * questions — from `lib/games/guides`.
 *
 * It depends only on the slug and runtime, never on the viewer or on data that
 * arrives later, so the server renders it whole and it hydrates unchanged. That
 * is what makes a game's page worth indexing rather than a title and a button.
 */
export function GameGuide({
  slug,
  title,
  runtime,
  instructions,
}: {
  slug: string;
  title: string;
  runtime?: string | null;
  instructions?: string | null;
}) {
  const rules = rulesFor(runtime);
  // The guides are written in English; an Albanian page keeps to the translated rules.
  const guide = currentLanguage() === "en" ? guideFor(slug) : null;

  return (
    <div className="mt-4 space-y-6">
      {(rules || instructions) && (
        <section aria-labelledby="how-to-play">
          <h2 id="how-to-play" className="text-base font-semibold">
            {t("How to play")}
          </h2>
          {rules ? (
            <>
              <p className="mt-1 mb-2 text-sm text-muted-foreground">{t(rules.summary)}</p>
              <RulesList rules={rules.rules} />
            </>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">{instructions}</p>
          )}
        </section>
      )}

      {guide && (
        <>
          <section aria-labelledby="about-game">
            <h2 id="about-game" className="text-base font-semibold">
              About {title}
            </h2>
            {guide.about.map((paragraph) => (
              <p key={paragraph} className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {paragraph}
              </p>
            ))}
          </section>

          <section aria-labelledby="game-tips">
            <h2 id="game-tips" className="text-base font-semibold">
              Tips and strategy
            </h2>
            <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
              {guide.tips.map((tip) => (
                <li key={tip}>{tip}</li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="game-faq">
            <h2 id="game-faq" className="text-base font-semibold">
              Questions
            </h2>
            <dl className="mt-2 space-y-3 text-sm">
              {guide.faq.map(([question, answer]) => (
                <div key={question}>
                  <dt className="font-medium">{question}</dt>
                  <dd className="mt-0.5 leading-relaxed text-muted-foreground">{answer}</dd>
                </div>
              ))}
            </dl>
          </section>
        </>
      )}
    </div>
  );
}
