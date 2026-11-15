/**
 * Tee Time (runtime `tee-time`) — a daily nine-hole golf course, as a pure
 * deterministic state machine.
 *
 * Every day a new nine is built from the date, the same for everyone: fairways
 * that bend, greens with bunkers around them, now and then a pond, and a wind on
 * every hole. Each shot is three choices — a club, a line, and the power you stop
 * the swing meter on. Reach the green and the putts are automatic: inside the
 * inner ring one putt, inside the outer ring two, anywhere else on the green three
 * (and a ball that stops by the cup drops). Fewer strokes, more points.
 *
 * This module is the *client's* copy of the rules. The authority is the database:
 * `public.complete_tee_time_run` in
 * `supabase/migrations/20270104120300_tee_time_sessions.sql` builds the same course
 * from the day and replays every shot on it. Everything here is integer arithmetic
 * — yards, a sine table, division that truncates toward zero (Postgres's `/`) — so
 * the two agree to the yard. `tee-time.test.ts` pins them together.
 *
 * ## The course
 *
 * A session's seed is the player's day number. The course comes from MINSTD seeded
 * with `day × 7919 + 31337`, drawn in exactly the order `buildCourse` draws it.
 *
 * ## A move
 *
 * A move is one shot: `club × 36000 + angle × 100 + (power − 1)`, with club 0–7,
 * angle 0–359 degrees clockwise from straight up the screen, and power 1–100.
 *
 * ## A shot
 *
 * The carry is the club's carry × power × the lie (tee and fairway 100%, rough 80%,
 * bunker 60%), and the wind pushes the landing by its yards per 100 yards of carry.
 * Landing in water or out of bounds costs a penalty stroke and the shot is played
 * again from where it was. Otherwise the ball rolls on along its line — 12% of the
 * carry on fairway, 8% on the green, 4% in the rough, none in a bunker — stopping
 * in a bunker it rolls into, or, rolling into water, a penalty stroke and the ball
 * left at the water's edge. A hole is over when the ball stops on the green (plus
 * its putts) or when it reaches par + 4 strokes, where the ball is picked up.
 *
 * ## The score
 *
 * Every finished hole scores `max(0, par + 3 − strokes) × 10`: 30 for a par, 40 a
 * birdie, 50 an ace on a par 3 (the screen shows ten times that). An unfinished
 * hole scores nothing.
 */

export const TEE_TIME_RUNTIME = "tee-time";
export const TEE_TIME_RULES_VERSION = "tee-time@1";

export const HOLES = 9;
export const POINTS_PER_STROKE = 10;
/** Strokes over par at which the ball is picked up. */
export const PICK_UP_OVER_PAR = 4;

export type Club = { readonly name: string; readonly short: string; readonly carry: number };

export const CLUBS: readonly Club[] = [
  { name: "Driver", short: "D", carry: 250 },
  { name: "3-wood", short: "3W", carry: 215 },
  { name: "5-iron", short: "5i", carry: 185 },
  { name: "7-iron", short: "7i", carry: 160 },
  { name: "9-iron", short: "9i", carry: 135 },
  { name: "Wedge", short: "PW", carry: 110 },
  { name: "Sand wedge", short: "SW", carry: 80 },
  { name: "Chip", short: "Ch", carry: 45 },
];

/** round(sin(d°) × 10000) for d = 0…90. Mirrored by `public.tee_time_sin`. */
export const SIN_TABLE: readonly number[] = [
  0, 175, 349, 523, 698, 872, 1045, 1219, 1392, 1564, 1736, 1908, 2079, 2250, 2419, 2588, 2756,
  2924, 3090, 3256, 3420, 3584, 3746, 3907, 4067, 4226, 4384, 4540, 4695, 4848, 5000, 5150, 5299,
  5446, 5592, 5736, 5878, 6018, 6157, 6293, 6428, 6561, 6691, 6820, 6947, 7071, 7193, 7314, 7431,
  7547, 7660, 7771, 7880, 7986, 8090, 8192, 8290, 8387, 8480, 8572, 8660, 8746, 8829, 8910, 8988,
  9063, 9135, 9205, 9272, 9336, 9397, 9455, 9511, 9563, 9613, 9659, 9703, 9744, 9781, 9816, 9848,
  9877, 9903, 9925, 9945, 9962, 9976, 9986, 9994, 9998, 10000,
];

const PAR_TEMPLATES: readonly (readonly number[])[] = [
  [4, 3, 5, 4, 4, 3, 4, 5, 4],
  [4, 4, 3, 5, 4, 4, 3, 4, 5],
  [5, 4, 3, 4, 4, 5, 3, 4, 4],
  [4, 3, 4, 4, 5, 3, 4, 4, 5],
];

/** Eight compass offsets, ×100: up, up-right, right… */
const OFFSETS: readonly (readonly [number, number])[] = [
  [0, 100], [71, 71], [100, 0], [71, -71], [0, -100], [-71, -71], [-100, 0], [-71, 71],
]; // prettier-ignore

export type Disc = { readonly x: number; readonly y: number; readonly r: number };

export type Surface = "tee" | "fairway" | "rough" | "sand" | "green" | "water" | "out";

export type Hole = {
  readonly par: number;
  readonly length: number;
  readonly pin: { readonly x: number; readonly y: number };
  readonly green: number;
  readonly fairway: readonly Disc[];
  readonly bunkers: readonly Disc[];
  readonly water: readonly Disc[];
  readonly wind: { readonly x: number; readonly y: number };
  readonly bounds: {
    readonly minX: number;
    readonly maxX: number;
    readonly minY: number;
    readonly maxY: number;
  };
};

/** Integer division that truncates toward zero, as Postgres's `/` on integers. */
export function div(a: number, b: number): number {
  // `+ 0` turns a −0 into 0, so positions compare and print as the database's.
  return Math.trunc(a / b) + 0;
}

/** MINSTD: the same draws in every engine. `next(n)` is 0 … n − 1. */
export function minstd(seed: number) {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  return (n: number) => {
    state = (state * 48271) % 2147483647;
    return state % n;
  };
}

/** sin(angle) × 10000 for any whole angle in degrees. */
export function sinDeg(angle: number): number {
  const a = ((angle % 360) + 360) % 360;
  if (a <= 90) return SIN_TABLE[a]!;
  if (a <= 180) return SIN_TABLE[180 - a]!;
  if (a <= 270) return -SIN_TABLE[a - 180]!;
  return -SIN_TABLE[360 - a]!;
}

/** The unit step of a line at this angle, ×10000: x right, y up the hole. */
export function heading(angle: number): { dx: number; dy: number } {
  return { dx: sinDeg(angle), dy: sinDeg(angle + 90) };
}

function buildHole(par: number, rand: (n: number) => number): Hole {
  const length = par === 3 ? 110 + rand(80) : par === 4 ? 290 + rand(110) : 440 + rand(80);
  const points: { x: number; y: number }[] = [{ x: 0, y: 0 }];
  if (par === 4) {
    const cy = 210 + rand(50);
    const cx = rand(91) - 45;
    points.push({ x: cx, y: cy });
    points.push({ x: cx + rand(81) - 40, y: length });
  } else if (par === 5) {
    const c1y = 220 + rand(40);
    const c1x = rand(81) - 40;
    const c2y = c1y + 110 + rand(30);
    const c2x = c1x + rand(81) - 40;
    points.push({ x: c1x, y: c1y }, { x: c2x, y: c2y });
    points.push({ x: c2x + rand(61) - 30, y: length });
  } else {
    points.push({ x: rand(41) - 20, y: length });
  }
  const pin = points[points.length - 1]!;
  const green = 12 + rand(6);
  const fairwayRadius = 16 + rand(8);

  const fairway: Disc[] = [];
  if (par === 3) {
    fairway.push({ x: pin.x, y: pin.y - green - 4, r: 9 });
  } else {
    for (let i = 0; i + 1 < points.length; i += 1) {
      const a = points[i]!;
      const b = points[i + 1]!;
      const steps = Math.max(1, div(b.y - a.y, 15));
      for (let k = 0; k <= steps; k += 1) {
        const x = a.x + div((b.x - a.x) * k, steps);
        const y = a.y + div((b.y - a.y) * k, steps);
        if (y >= 120) fairway.push({ x, y, r: fairwayRadius });
      }
    }
  }

  const bunkers: Disc[] = [];
  const greenside = 1 + rand(3);
  for (let i = 0; i < greenside; i += 1) {
    const [ox, oy] = OFFSETS[rand(8)]!;
    const distance = green + 3 + rand(4);
    bunkers.push({
      x: pin.x + div(ox * distance, 100),
      y: pin.y + div(oy * distance, 100),
      r: 4 + rand(4),
    });
  }
  if (par !== 3 && rand(2) === 0) {
    const corner = points[1]!;
    const side = rand(2) === 0 ? -1 : 1;
    bunkers.push({
      x: corner.x + side * (fairwayRadius + 2),
      y: corner.y - 10 + rand(20),
      r: 6 + rand(4),
    });
  }

  const water: Disc[] = [];
  if (rand(3) === 0) {
    if (par === 3) {
      water.push({ x: pin.x + rand(21) - 10, y: pin.y - green - 12 - rand(10), r: 9 + rand(6) });
    } else {
      const corner = points[1]!;
      const side = rand(2) === 0 ? -1 : 1;
      water.push({
        x: corner.x + side * (fairwayRadius + 14 + rand(10)),
        y: corner.y + rand(40) - 20,
        r: 14 + rand(8),
      });
    }
  }

  const wind = { x: rand(11) - 5, y: rand(11) - 5 };
  const xs = points.map((p) => p.x);
  return {
    par,
    length,
    pin,
    green,
    fairway,
    bunkers,
    water,
    wind,
    bounds: {
      minX: Math.min(...xs) - 70,
      maxX: Math.max(...xs) + 70,
      minY: -30,
      maxY: length + 35,
    },
  };
}

/** The day's nine. */
export function buildCourse(day: number): Hole[] {
  const rand = minstd(day * 7919 + 31337);
  const pars = PAR_TEMPLATES[rand(PAR_TEMPLATES.length)]!;
  return pars.map((par) => buildHole(par, rand));
}

function inside(disc: Disc, x: number, y: number): boolean {
  return (x - disc.x) ** 2 + (y - disc.y) ** 2 <= disc.r * disc.r;
}

/** What the ground is at a point. Order matters: the green beats everything on it. */
export function surfaceAt(hole: Hole, x: number, y: number): Surface {
  const b = hole.bounds;
  if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) return "out";
  if ((x - hole.pin.x) ** 2 + (y - hole.pin.y) ** 2 <= hole.green * hole.green) return "green";
  if (hole.water.some((d) => inside(d, x, y))) return "water";
  if (hole.bunkers.some((d) => inside(d, x, y))) return "sand";
  if (x * x + y * y <= 25) return "tee";
  if (hole.fairway.some((d) => inside(d, x, y))) return "fairway";
  return "rough";
}

const LIE_PERCENT: Record<Surface, number> = {
  tee: 100,
  fairway: 100,
  green: 100,
  rough: 80,
  sand: 60,
  water: 0,
  out: 0,
};

const ROLL_PERCENT: Record<Surface, number> = {
  tee: 12,
  fairway: 12,
  green: 8,
  rough: 4,
  sand: 0,
  water: 0,
  out: 0,
};

/** The putts from a resting point on the green: 0 by the cup, then the rings. */
export function puttsFrom(hole: Hole, x: number, y: number): number {
  const d2 = (x - hole.pin.x) ** 2 + (y - hole.pin.y) ** 2;
  if (d2 <= 1) return 0;
  if (d2 <= INNER_RING * INNER_RING) return 1;
  if (d2 <= OUTER_RING * OUTER_RING) return 2;
  return 3;
}

/** The one-putt ring's radius, in yards. */
export const INNER_RING = 3;
/** The two-putt ring's. */
export const OUTER_RING = 9;

export type Shot = { readonly club: number; readonly angle: number; readonly power: number };

export function encodeShot(shot: Shot): number {
  return shot.club * 36000 + shot.angle * 100 + (shot.power - 1);
}

export function decodeShot(move: number): Shot | null {
  if (!Number.isInteger(move) || move < 0 || move >= CLUBS.length * 36000) return null;
  return {
    club: Math.floor(move / 36000),
    angle: Math.floor(move / 100) % 360,
    power: (move % 100) + 1,
  };
}

/** What happened to one shot, for the screen to draw. */
export type ShotResult = {
  readonly from: { x: number; y: number };
  readonly landing: { x: number; y: number };
  readonly rest: { x: number; y: number };
  readonly penalty: boolean;
  readonly landed: Surface;
  readonly carry: number;
};

export type HoleCard = {
  readonly strokes: number;
  readonly putts: number;
  readonly pickedUp: boolean;
};

export type TeeTimeRun = {
  readonly day: number;
  readonly rulesVersion: string;
  readonly course: readonly Hole[];
  /** The hole being played, 0–8; 9 once the round is done. */
  readonly hole: number;
  readonly ball: { readonly x: number; readonly y: number };
  /** Strokes on the current hole, penalties included. */
  readonly strokes: number;
  /** Every finished hole. */
  readonly cards: readonly HoleCard[];
  readonly lastShot: ShotResult | null;
  /** Every shot. This *is* the submission. */
  readonly moves: readonly number[];
  readonly outcome: "playing" | "over";
  readonly ending: "finished" | "stopped" | null;
};

export function createRun(day: string | number, rulesVersion = TEE_TIME_RULES_VERSION): TeeTimeRun {
  const d = Number(day);
  return {
    day: d,
    rulesVersion,
    course: buildCourse(d),
    hole: 0,
    ball: { x: 0, y: 0 },
    strokes: 0,
    cards: [],
    lastShot: null,
    moves: [],
    outcome: "playing",
    ending: null,
  };
}

export function currentHole(run: TeeTimeRun): Hole | null {
  return run.course[run.hole] ?? null;
}

/** Plays a shot. A shot that cannot be played returns the same run object. */
export function playShot(run: TeeTimeRun, shot: Shot): TeeTimeRun {
  const hole = currentHole(run);
  if (run.outcome !== "playing" || !hole) return run;
  const { club, angle, power } = shot;
  if (
    !Number.isInteger(club) || club < 0 || club >= CLUBS.length ||
    !Number.isInteger(angle) || angle < 0 || angle >= 360 ||
    !Number.isInteger(power) || power < 1 || power > 100
  ) {
    return run;
  } // prettier-ignore

  const from = run.ball;
  const lie = surfaceAt(hole, from.x, from.y);
  const carry = div(CLUBS[club]!.carry * power * LIE_PERCENT[lie], 10000);
  const { dx, dy } = heading(angle);
  const landing = {
    x: from.x + div(dx * carry, 10000) + div(hole.wind.x * carry, 100),
    y: from.y + div(dy * carry, 10000) + div(hole.wind.y * carry, 100),
  };
  let strokes = run.strokes + 1;
  const landed = surfaceAt(hole, landing.x, landing.y);
  let rest = from;
  let penalty = false;

  if (landed === "water" || landed === "out") {
    strokes += 1;
    penalty = true;
  } else {
    const roll = div(carry * ROLL_PERCENT[landed], 100);
    let x = landing.x;
    let y = landing.y;
    for (let k = 1; k <= roll; k += 1) {
      const qx = landing.x + div(dx * k, 10000);
      const qy = landing.y + div(dy * k, 10000);
      const ground = surfaceAt(hole, qx, qy);
      if (ground === "water" || ground === "out") {
        strokes += 1;
        penalty = true;
        break;
      }
      x = qx;
      y = qy;
      if (ground === "sand") break;
    }
    rest = { x, y };
  }

  const cap = hole.par + PICK_UP_OVER_PAR;
  const shotResult: ShotResult = { from, landing, rest, penalty, landed, carry };
  const moves = [...run.moves, encodeShot(shot)];
  const onGreen = surfaceAt(hole, rest.x, rest.y) === "green";

  if (onGreen || strokes >= cap) {
    const putts = onGreen ? puttsFrom(hole, rest.x, rest.y) : 0;
    const total = Math.min(cap, strokes + putts);
    const card: HoleCard = { strokes: total, putts, pickedUp: !onGreen || strokes + putts > cap };
    const cards = [...run.cards, card];
    const done = cards.length >= HOLES;
    return {
      ...run,
      hole: run.hole + 1,
      ball: { x: 0, y: 0 },
      strokes: 0,
      cards,
      lastShot: shotResult,
      moves,
      outcome: done ? "over" : "playing",
      ending: done ? "finished" : null,
    };
  }

  return { ...run, ball: rest, strokes, lastShot: shotResult, moves };
}

export function stop(run: TeeTimeRun): TeeTimeRun {
  if (run.outcome !== "playing") return run;
  return { ...run, outcome: "over", ending: "stopped" };
}

export function holePoints(par: number, strokes: number): number {
  return Math.max(0, par + 3 - strokes) * POINTS_PER_STROKE;
}

export function scoreOf(run: TeeTimeRun): number {
  return run.cards.reduce((sum, card, i) => sum + holePoints(run.course[i]!.par, card.strokes), 0);
}

export function submission(run: TeeTimeRun) {
  return { rulesVersion: run.rulesVersion, actions: run.moves, score: scoreOf(run) };
}

export function replay(day: string | number, actions: readonly number[]): TeeTimeRun {
  return actions.reduce((run, move) => {
    const shot = decodeShot(move);
    return shot ? playShot(run, shot) : run;
  }, createRun(day));
}

export function coursePar(course: readonly Hole[]): number {
  return course.reduce((sum, hole) => sum + hole.par, 0);
}

/** Yards from the ball to the pin, rounded. */
export function yardsToPin(hole: Hole, ball: { x: number; y: number }): number {
  return Math.round(Math.hypot(hole.pin.x - ball.x, hole.pin.y - ball.y));
}

/** The whole-degree line from the ball to a point. */
export function angleTo(from: { x: number; y: number }, to: { x: number; y: number }): number {
  const degrees = (Math.atan2(to.x - from.x, to.y - from.y) * 180) / Math.PI;
  return ((Math.round(degrees) % 360) + 360) % 360;
}

/** The club a player most likely wants: the shortest that reaches the pin from this lie. */
export function suggestedClub(hole: Hole, ball: { x: number; y: number }): number {
  const lie = LIE_PERCENT[surfaceAt(hole, ball.x, ball.y)];
  const distance = yardsToPin(hole, ball);
  for (let club = CLUBS.length - 1; club >= 0; club -= 1) {
    if (div(CLUBS[club]!.carry * lie, 100) >= distance) return club;
  }
  return 0;
}

/** The carry a club would fly from the ball's lie at full power. */
export function fullCarry(hole: Hole, ball: { x: number; y: number }, club: number): number {
  return div(CLUBS[club]!.carry * LIE_PERCENT[surfaceAt(hole, ball.x, ball.y)], 100);
}
