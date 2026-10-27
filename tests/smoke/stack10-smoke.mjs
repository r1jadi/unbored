#!/usr/bin/env node
/**
 * Stack 10 against a live API: the whole play path, in one command.
 *
 *   API_BASE=http://127.0.0.1:8090/api/v1 node tests/smoke/stack10-smoke.mjs
 *   API_BASE=https://unbored.lol/api/v1 node tests/smoke/stack10-smoke.mjs
 *
 * It is a *smoke* test, not a unit test: it starts a real session, plays a real
 * run, submits it, and checks what the server did with it. Run it against a local
 * stack before deploying and against production after, because the things it
 * covers — the gateway forwarding `/sessions`, the service reaching PostgREST with
 * no master key, the verifier accepting a run and refusing a forgery — only exist
 * when all of that is wired up.
 *
 * The rules are reimplemented here on purpose. A script that imported the client's
 * engine could pass while the engine and the verifier disagreed; two independent
 * implementations producing the same score is the evidence that matters. The
 * authoritative statement of the rules, with the vectors this pins, is
 * `docs/games/README.md`.
 */
import { strict as assert } from "node:assert";

const API_BASE = (process.env.API_BASE ?? "http://127.0.0.1:8090/api/v1").replace(/\/+$/, "");
const GAME = process.env.STACK10_SLUG ?? "stack-10";
const RULES = "stack-10@1";
const TOKEN = process.env.API_TOKEN ?? "";

const COLUMNS = 4;
const TILES = 60;
const SEED_MODULUS = 4294967296n;
const MULTIPLIER = 1664525n;
const INCREMENT = 1013904223n;
const ZERO_STATE = 2654435769n;

let failures = 0;
const results = [];

function check(name, condition, detail = "") {
  const ok = !!condition;
  if (!ok) failures += 1;
  results.push({ name, ok, detail });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

function headers(extra = {}) {
  const base = { "Content-Type": "application/json", ...extra };
  if (TOKEN) base.Authorization = `Bearer ${TOKEN}`;
  return base;
}

async function call(method, path, body) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: headers(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : undefined;
  } catch {
    payload = text;
  }
  return { status: response.status, payload };
}

/** The verifier's deck: a 32-bit LCG over the seed, tiles 1..9. */
function deck(seed, count) {
  let state = ((BigInt(seed) % SEED_MODULUS) + SEED_MODULUS) % SEED_MODULUS;
  if (state === 0n) state = ZERO_STATE;
  const tiles = [];
  for (let index = 0; index < count; index += 1) {
    state = (state * MULTIPLIER + INCREMENT) % SEED_MODULUS;
    tiles.push(Number(state % 9n) + 1);
  }
  return tiles;
}

/**
 * Plays conservatively, which is the same thing as playing well: a column that
 * clears scores, so take an available clear; otherwise keep the tiles as shallow
 * as possible, because a column over ten ends the run.
 */
function play(tiles) {
  const sums = Array(COLUMNS).fill(0);
  const stacks = Array(COLUMNS).fill(0);
  const actions = [];
  let score = 0;
  let cleared = 0;

  for (const tile of tiles) {
    let choice = -1;
    for (let column = 0; column < COLUMNS; column += 1) {
      if (sums[column] + tile > 10) continue;
      if (choice === -1) choice = column;
      // Prefer the clear, then the most-stacked column that still fits.
      const better =
        (sums[column] + tile === 10 && sums[choice] + tile !== 10) ||
        (sums[column] + tile === sums[choice] + tile && stacks[column] > stacks[choice]);
      if (better) choice = column;
    }
    if (choice === -1) {
      // Every column would go over. This is the run-ending move, and it must be
      // played and submitted exactly like any other.
      choice = sums.indexOf(Math.max(...sums));
    }

    actions.push(choice);
    stacks[choice] += 1;
    sums[choice] += tile;
    if (sums[choice] === 10) {
      score += 10 + 5 * (stacks[choice] - 1);
      cleared += 1;
      sums[choice] = 0;
      stacks[choice] = 0;
    } else if (sums[choice] > 10) {
      break; // the run is over; the move that ended it is part of the run
    }
  }

  return { actions, score, cleared, tilesPlaced: actions.length };
}

// The clock starts where the client's does: when the run is issued. The verifier
// refuses a duration longer than the session has existed, which is what stops a
// client from claiming an implausible run time — and what makes measuring it here
// part of the test rather than a detail.
const startedAt = Date.now();
const started = await call("POST", "/sessions", {
  gameSlug: GAME,
  rulesVersion: RULES,
  client: "smoke/1.0",
});
const elapsed = () => Math.max(1, Date.now() - startedAt);

check("POST /sessions issues a run", started.status === 201, `status ${started.status}`);
if (started.status !== 201) {
  console.error(JSON.stringify(started.payload));
  process.exit(1);
}

const session = started.payload;
check(
  "the session names the game and the rules",
  session.gameSlug === GAME && session.rulesVersion === RULES,
);
check(
  "the seed is a decimal string the client must not round",
  /^-?\d+$/.test(String(session.seed)),
);
check("the run is sixty tiles", session.tileCount === TILES);
// With API_TOKEN the script is a signed-in player, and the run is ranked; without
// one it is a guest, whose run is verified all the same and never scored.
check(
  TOKEN ? "a signed-in player's run is ranked" : "a guest run is not ranked",
  session.ranked === Boolean(TOKEN),
  TOKEN ? "with API_TOKEN" : "(set API_TOKEN for the ranked path)",
);

const run = play(deck(session.seed, TILES));
check("the run has at least one move", run.actions.length > 0, `${run.actions.length} tiles`);

const completion = await call("POST", `/sessions/${session.id}/complete`, {
  score: run.score,
  durationMs: elapsed(),
  progress: { rulesVersion: RULES, actions: run.actions },
});

check("the server verifies the run", completion.status === 200, `status ${completion.status}`);
if (completion.status === 200) {
  check(
    "the score is the database's replay of this run",
    completion.payload.score === run.score,
    `server ${completion.payload.score}, script ${run.score}`,
  );
  check(
    "the replay reports the same clear count",
    completion.payload.clearedColumns === run.cleared,
    `server ${completion.payload.clearedColumns}, script ${run.cleared}`,
  );
  check("the submission was recorded, not a duplicate", completion.payload.duplicate === false);
  check(
    TOKEN
      ? "a ranked run reports the player's rank and best"
      : "an unranked run has no rank and no personal best",
    TOKEN
      ? completion.payload.rank !== null && completion.payload.personalBest !== null
      : completion.payload.rank === null && completion.payload.personalBest === null,
    TOKEN ? `rank ${completion.payload.rank}, best ${completion.payload.personalBest}` : "",
  );
}

const retry = await call("POST", `/sessions/${session.id}/complete`, {
  score: run.score,
  durationMs: elapsed(),
  progress: { rulesVersion: RULES, actions: run.actions },
});
check(
  "a retry is recognised, not recorded again",
  retry.status === 200 && retry.payload.duplicate === true && retry.payload.score === run.score,
  `status ${retry.status}`,
);

// A different run for a session that is already closed: the first verified result
// is the one that stands, so this cannot replace it.
const replacement = await call("POST", `/sessions/${session.id}/complete`, {
  score: run.score,
  durationMs: elapsed(),
  progress: { rulesVersion: RULES, actions: [...run.actions, 0] },
});
check(
  "a closed run cannot be replaced by a different one",
  replacement.status === 409,
  `status ${replacement.status}`,
);

// A forged score on a *fresh* session, so the refusal is the replay disagreeing
// rather than the session being closed.
const forgeStartedAt = Date.now();
const forgeSession = await call("POST", "/sessions", {
  gameSlug: GAME,
  rulesVersion: RULES,
  client: "smoke/1.0",
});
check("a second run can be started", forgeSession.status === 201, `status ${forgeSession.status}`);
if (forgeSession.status === 201) {
  const forgeRun = play(deck(forgeSession.payload.seed, TILES));
  const forged = await call("POST", `/sessions/${forgeSession.payload.id}/complete`, {
    score: forgeRun.score + 1000,
    durationMs: Math.max(1, Date.now() - forgeStartedAt),
    progress: { rulesVersion: RULES, actions: forgeRun.actions },
  });
  const message = String(forged.payload?.error?.message ?? "");
  check(
    "a forged score is refused as a score mismatch",
    forged.status === 422 && /score/i.test(message),
    `status ${forged.status} ${message}`,
  );

  // The same session, with a partial run: the ending move cannot be dropped.
  const partial = await call("POST", `/sessions/${forgeSession.payload.id}/complete`, {
    score: 0,
    durationMs: Math.max(1, Date.now() - forgeStartedAt),
    progress: { rulesVersion: RULES, actions: forgeRun.actions.slice(0, -1) },
  });
  check(
    "a partial run is refused",
    partial.status === 422 || partial.status === 409,
    `status ${partial.status}`,
  );
}

const impossible = await call("POST", "/sessions", {
  gameSlug: GAME,
  rulesVersion: RULES,
  client: "smoke/1.0",
});
if (impossible.status === 201) {
  const bad = await call("POST", `/sessions/${impossible.payload.id}/complete`, {
    score: 999,
    durationMs: 1000,
    progress: { rulesVersion: RULES, actions: [9, 9] },
  });
  check("a column off the board is refused", bad.status === 400, `status ${bad.status}`);
}

const other = await call("POST", "/sessions", {
  gameSlug: "color-merge",
  rulesVersion: RULES,
  client: "smoke/1.0",
});
check("a game with no runtime cannot start a run", other.status === 404, `status ${other.status}`);

const unknown = await call("POST", "/sessions", {
  gameSlug: "never-made",
  rulesVersion: RULES,
  client: "smoke/1.0",
});
check(
  "an unknown game is refused exactly like an unplayable one",
  unknown.status === 404,
  `status ${unknown.status}`,
);

const board = await call("GET", `/games/${GAME}/leaderboard?limit=5`);
check("the board answers", board.status === 200, `status ${board.status}`);
if (board.status === 200) {
  check(
    "the board is the requested window",
    board.payload.scope === "global" && board.payload.period === "all",
  );
  check("the board is a ranking, or honestly empty", Array.isArray(board.payload.entries));
  if (TOKEN) {
    check(
      "the board places the caller at the score they just earned",
      board.payload.me !== null && board.payload.me.score >= run.score,
      `standing ${JSON.stringify(board.payload.me)}`,
    );
    check(
      "the caller appears on the board itself",
      board.payload.entries.some((entry) => entry.score === board.payload.me.score),
    );
  } else {
    check("an anonymous caller has no standing on it", board.payload.me === null);
  }
}

const detail = await call("GET", `/games/${GAME}`);
check(
  "the game reports its real play count",
  detail.status === 200 && Number.isInteger(detail.payload.plays),
  `plays ${detail.payload?.plays}`,
);
check(
  "the game is playable and names its runtime",
  detail.payload?.playable === true && detail.payload?.runtime === "stack-10",
);

const unplayedBoard = await call("GET", "/games/color-merge/leaderboard");
check(
  "an unplayed game has an empty board, not a 404",
  unplayedBoard.status === 200 && unplayedBoard.payload.entries.length === 0,
  `status ${unplayedBoard.status}`,
);

const noSuchBoard = await call("GET", "/games/never-made/leaderboard");
check(
  "a board for a game that does not exist is a 404",
  noSuchBoard.status === 404,
  `status ${noSuchBoard.status}`,
);

const friendsBoard = await call("GET", `/games/${GAME}/leaderboard?scope=friends`);
check(
  "the unimplemented friends board is refused with a reason",
  friendsBoard.status === 400 && /global/.test(String(friendsBoard.payload?.error?.message ?? "")),
  `status ${friendsBoard.status}`,
);

console.log("");
console.log(
  `${results.filter((r) => r.ok).length}/${results.length} checks passed against ${API_BASE}`,
);
if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
assert.equal(failures, 0);
