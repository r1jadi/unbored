import { describe, expect, it } from "vitest";

import {
  buildCourse,
  CLUBS,
  createRun,
  decodeShot,
  div,
  encodeShot,
  HOLES,
  holePoints,
  minstd,
  playShot,
  puttsFrom,
  replay,
  scoreOf,
  sinDeg,
  stop,
  surfaceAt,
  type Hole,
} from "@/lib/games/tee-time";

/**
 * The engine's arithmetic is the database's (`public.tee_time_score` replays it in
 * plpgsql): these pin the pieces both must agree on. The whole replay is pinned by
 * the `daily-four` rows of tests/security/verifier_vectors.sql.
 */

describe("Tee Time's arithmetic", () => {
  it("divides toward zero, as Postgres does", () => {
    expect(div(7, 2)).toBe(3);
    expect(div(-7, 2)).toBe(-3);
    expect(div(-1, 10000)).toBe(0);
  });

  it("draws MINSTD", () => {
    const rand = minstd(1);
    expect(rand(2147483647)).toBe(48271);
    expect(rand(2147483647)).toBe(182605794);
  });

  it("reads sines from its table in every quadrant", () => {
    expect([sinDeg(0), sinDeg(90), sinDeg(180), sinDeg(270)]).toEqual([0, 10000, 0, -10000]);
    expect(sinDeg(30)).toBe(5000);
    expect(sinDeg(150)).toBe(5000);
    expect(sinDeg(210)).toBe(-5000);
    expect(sinDeg(330)).toBe(-5000);
    expect(sinDeg(390)).toBe(5000);
  });

  it("packs a shot into one move", () => {
    const shot = { club: 3, angle: 357, power: 64 };
    expect(encodeShot(shot)).toBe(3 * 36000 + 357 * 100 + 63);
    expect(decodeShot(encodeShot(shot))).toEqual(shot);
    expect(decodeShot(CLUBS.length * 36000)).toBeNull();
  });
});

describe("Tee Time's course", () => {
  it("is the same nine for the same day, and a different one the next", () => {
    expect(buildCourse(20406)).toEqual(buildCourse(20406));
    expect(buildCourse(20406)).not.toEqual(buildCourse(20407));
  });

  it("builds playable holes", () => {
    for (let day = 20000; day < 20060; day += 1) {
      const course = buildCourse(day);
      expect(course).toHaveLength(HOLES);
      const par = course.reduce((sum, h) => sum + h.par, 0);
      expect(par).toBe(36);
      for (const hole of course) {
        expect(surfaceAt(hole, 0, 0)).toBe("tee");
        expect(surfaceAt(hole, hole.pin.x, hole.pin.y)).toBe("green");
      }
    }
  });

  it("counts putts by the rings", () => {
    const hole = buildCourse(20406)[0]!;
    const at = (dx: number, dy: number) => puttsFrom(hole, hole.pin.x + dx, hole.pin.y + dy);
    expect(at(0, 0)).toBe(0);
    expect(at(1, 0)).toBe(0);
    expect(at(3, 0)).toBe(1);
    expect(at(6, 6)).toBe(2);
    expect(at(10, 0)).toBe(3);
  });
});

/** The bot the vectors use: the suggested club straight at the pin, the power to reach it. */
function botRound(day: number) {
  let run = createRun(day);
  while (run.outcome === "playing") {
    const hole = run.course[run.hole]! as Hole;
    const dx = hole.pin.x - run.ball.x;
    const dy = hole.pin.y - run.ball.y;
    const angle = (((Math.round((Math.atan2(dx, dy) * 180) / Math.PI) % 360) + 360) %
      360) as number;
    run = playShot(run, {
      club: 0,
      angle,
      power: Math.min(100, Math.max(1, Math.round(Math.hypot(dx, dy) / 2.5))),
    });
  }
  return run;
}

describe("a Tee Time round", () => {
  it("plays nine holes to the end and scores each finished one", () => {
    const run = botRound(20406);
    expect(run.ending).toBe("finished");
    expect(run.cards).toHaveLength(HOLES);
    expect(scoreOf(run)).toBe(
      run.cards.reduce((sum, card, i) => sum + holePoints(run.course[i]!.par, card.strokes), 0),
    );
    for (const [i, card] of run.cards.entries()) {
      expect(card.strokes).toBeLessThanOrEqual(run.course[i]!.par + 4);
    }
    expect(replay(20406, run.moves)).toEqual(run);
  });

  it("costs a stroke out of bounds and plays again from the same spot", () => {
    let run = createRun(20406);
    run = playShot(run, { club: 0, angle: 90, power: 100 });
    expect(run.lastShot!.penalty).toBe(true);
    expect(run.strokes).toBe(2);
    expect(run.ball).toEqual({ x: 0, y: 0 });
  });

  it("scores nothing for an unfinished hole", () => {
    const run = stop(playShot(createRun(20406), { club: 0, angle: 0, power: 50 }));
    expect(run.ending).toBe("stopped");
    expect(scoreOf(run)).toBe(0);
    expect(holePoints(4, 4)).toBe(30);
    expect(holePoints(3, 1)).toBe(50);
    expect(holePoints(4, 8)).toBe(0);
  });
});
