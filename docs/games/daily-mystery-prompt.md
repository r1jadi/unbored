# Prompt: add a daily mini-mystery to Unbored

Copy everything below the line into a new Claude Code session in this repository.

---

Add a new daily game to Unbored: **a mini mystery case**, one new case every day,
solvable in **3–5 minutes**. It is a small version of **Powehi**
(https://powehi-case.vercel.app), our full-length mystery app, where cases take 30–120
minutes. This game should give people the same "I caught the liar" feeling in a
lunch-break-sized dose, and make them curious about Powehi's full cases.

Working name: **Alibi** (it's the same word in English and Albanian). Ask me before
settling the name if you have a better one.

## Why we're building it

- Unbored needs a hero daily game with a strong hook. Our Shorts data shows people
  want puzzles they can play along with, and "one of them is lying, who?" is our
  strongest hook.
- Powehi has great cases but players finish them fast and have no daily reason to
  return. A daily mini case brings them back every day and points them to the full
  cases.
- Each daily case is also tomorrow's video: "Here are 3 alibis. One is a lie. Who?"

## How Powehi plays (keep the feel, shrink the size)

Open Powehi's training case, _The Empty Till_, to see the style. Each case has:

- a **desk of documents**: witness statements written as police interview
  transcripts, a till log, a delivery sheet with GPS times, a sticky note;
- a **wall** where the player pins evidence and connects it;
- an **accusation form** where the player names the culprit;
- a calm, grounded "detective's file" tone, with real-sounding places and times and
  no fantasy.

The mini version keeps the documents, the contradiction and the accusation. It drops
the free-form wall, the multi-part accusation and anything longer than a few minutes.

## The game

**One case a day:**

- A one-line setup: "The café's till was £412 short at closing. Three people had
  the chance."
- **3 suspects**, each with a name, a role and a short statement (2–4 lines).
- **4–6 evidence cards**: a log, a receipt, a timetable, a text message, a CCTV
  timestamp, a photo caption. Short enough to read on a phone in a few seconds each.
- **Exactly one contradiction** between a statement and a piece of evidence exposes
  the culprit. Everything needed to find it is on the cards.
- One or two **red herrings** (a suspect with a motive, a suspicious-looking detail
  that turns out to be innocent).

**Playing:**

1. Read the setup and the three statements (always free).
2. Open evidence cards one at a time. Every card opened costs a little score, so the
   sharpest players open fewer.
3. To accuse, the player picks **the culprit** _and_ **the card that proves it**.
   Asking for the proof stops people guessing their way through a 1-in-3 choice.
4. A wrong accusation costs score and leaves one fewer try. Allow 2 tries; after the
   second miss the case is closed and the solution is shown.
5. Then the **reveal**: one short paragraph explaining the contradiction, written like
   a detective closing the file.

**Score** (decide the exact numbers and document them in `docs/games/README.md` like
every other game): a solve is worth the most with the right proof on the first try,
with few cards opened and a quick time. Add a star rating (★–★★★) the way Powehi
rates cases.

**The share result** must not spoil the case:

```
Alibi #12 🔎 Solved
⭐⭐⭐ · 3/6 files · 2:41
unbored.lol
```

## The cases (the hardest part, plan it first)

The game lives or dies on case quality. Every case must be fair: solvable from the
cards alone, with exactly one culprit and exactly one proof.

- Build a **bank of at least 60 cases** before launch, in the same way other daily
  games have banks (see `src/lib/games/dead-reckoning-bank.ts` and
  `scripts/generate-daily-banks.ts`).
- Store each case as structured data (setup, suspects, statements, cards, culprit,
  proving card, solution text), not as free text, so the verifier can check answers.
- Write a **checker** that runs over the whole bank and fails if a case has no
  contradiction, more than one possible culprit, a proving card that doesn't
  mention the culprit's statement, or text too long for a phone screen.
- If you use an LLM to draft cases, every case still goes through the checker, and
  I review the first 10 by hand before you write the rest.
- Every case needs an **Albanian version**, written properly, not machine-literal.
  Settings can be local (Prishtina, Tirana, Prizren, Durrës) as well as the British
  settings Powehi uses.
- Vary the crimes: thefts, a broken window, a missing dog, a forged signature, a
  spoiled cake at a wedding. Keep it light. No murder in the daily game, since that
  stays Powehi's thing.

## Fit it into Unbored the way every other daily game fits

Follow the pattern of the most recent daily game, Dead Reckoning (commit `6bfa86c`),
which touched everything a new daily game needs:

- engine, bank and tests in `src/lib/games/`;
- a runtime in `src/components/game/` plus a feed preview and catalogue art;
- the server-side verifier and day seed in Supabase migrations, so a score only
  exists if the database replays the run (the **answer must not be shipped to the
  browser** before the player accuses; check how the existing games keep answers
  server-side and follow that);
- Go ruleset routing in `services/game-sessions/internal/rulesets/`;
- Unlimited, the archive of past puzzles, offline support, the sitemap, Albanian
  translations, verifier test vectors, the RLS test list and the game docs.

Read `docs/games/README.md` and the Dead Reckoning commit before you start, and ask me
if anything in the design above conflicts with how the platform works.

## The link to Powehi

After the reveal, show one quiet line: "Liked this? Powehi has full-length cases to
solve alone or with friends →" linking to https://powehi-case.vercel.app. One line,
no pop-up, no banner.

## Don't

- Don't make cases that need outside knowledge, trick wording or a leap of
  imagination. The answer must be on the cards.
- Don't let the culprit be guessable from the setup alone (the "obviously shady"
  suspect should usually be the red herring).
- Don't show the culprit or proving card anywhere in the page source before the
  accusation.
- Don't make it longer than 5 minutes for an average player. If a case needs more
  than 6 cards, it's a Powehi case, not a daily one.
- Don't copy Powehi's cases. The daily bank is its own set.

## Done means

- A new case appears every day, plays well on a phone, in English and Albanian.
- The bank of 60+ cases passes the checker, and I've approved the first 10.
- Scores are server-verified like every other game, and the tests and the RLS suite
  pass.
- The share result is spoiler-free.
- The game docs explain the rules, scoring and verifier, like every other game.

Start by proposing the case data format and **3 sample cases** (English and
Albanian) for me to read, before writing any code.
