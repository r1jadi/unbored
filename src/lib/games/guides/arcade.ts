import type { GameGuide } from "./types";

/** Reflex, rhythm and memory games: no final level, just how long you last. */
export const ARCADE_GUIDES = {
  "dont-touch-the-black": {
    about: [
      "Don't Touch the Black is a reflex game. Rows of tiles rise towards a line; as each row reaches it, tap every white tile in it. Tap a black tile and the run ends on the spot — and if a row leaves the line with a white tile still on it, the run ends too.",
      "There is no final row. Every row tightens the beat, more of each row turns black the longer you last, and the screen grows darker until you can barely see what's coming. On a keyboard, the number keys 1–3 or A, S and D tap the three lanes.",
    ],
    tips: [
      "Read one row ahead. By the time a row reaches the line you should already know where its white tiles are.",
      "Find a rhythm and stay in it. The beat speeds up gradually, so tapping in time is steadier than reacting to each row.",
      "Use the keyboard if you can. Three fingers resting on A, S and D are faster than moving one finger around a screen.",
      "Stay relaxed. Tense hands overshoot; light taps are quicker and more accurate.",
    ],
    faq: [
      [
        "What ends the run?",
        "Tapping a black tile, or letting a row pass the line with a white tile still on it.",
      ],
      [
        "Why is it getting harder to see?",
        "The screen darkens the longer you last — it's part of the challenge.",
      ],
    ],
  },
  "dont-break-the-chain": {
    about: [
      "Don't Break the Chain is a sequence-memory game. Four pads flash in order; watch, then tap them back in the same order. Every round adds one more step and the beat gets a little quicker. A single wrong tap breaks the chain and ends the run.",
      "Every correct tap scores 10 points, and there's no final round, so your score is a direct measure of how long a sequence you can hold in your head. Number keys 1 to 4 work too.",
    ],
    tips: [
      "Group the sequence. Remembering three chunks of three is much easier than nine separate flashes.",
      "Name the pads. Saying numbers or directions in your head as they flash — 'one, three, three, two' — turns a visual memory into a verbal one, which most people hold more easily.",
      "Tap at a steady pace. There's no prize for speed, and rushing is how wrong taps happen.",
      "Use the keys 1 to 4 on a keyboard: they map neatly onto a remembered list of numbers.",
    ],
    faq: [
      [
        "Is there a final round?",
        "No. The chain grows by a step every round until you make a mistake.",
      ],
      ["How is the score counted?", "Every correct tap is worth 10 points."],
    ],
  },
  "memory-flash": {
    about: [
      "Memory Flash is a visual-memory game. A pattern of cells lights up on a grid for a moment, then disappears. Tap the cells that were lit — in any order — to rebuild it. One wrong or repeated cell ends the run, and every rebuilt pattern is worth 100 points.",
      "There's no final pattern. Each round adds a cell, the flash gets shorter, and the board grows when the pattern outgrows it.",
    ],
    tips: [
      "See shapes, not cells. Lit cells often form lines, corners or letters, and a shape is easier to remember than a list of positions.",
      "Split the board into quarters and remember how many cells were in each.",
      "Tap the cells you're surest of first, while the picture is fresh, then fill in the rest.",
      "Don't tap a cell twice. A repeated cell counts as a mistake, so keep track of what you've already tapped.",
    ],
    faq: [
      ["Does the order of my taps matter?", "No. You can tap the lit cells in any order."],
      ["What ends the run?", "Tapping a cell that wasn't lit, or tapping the same cell twice."],
    ],
  },
  updraft: {
    about: [
      "Updraft is a one-button flying game. Tap, click or press Space to flap and lift your glider; between flaps it falls. Steer through the gaps between columns: every column you pass is worth 10 points.",
      "Touching a column or the ground ends the run, though the top of the sky is safe to brush. There's no last column — the field speeds up and the gaps narrow as you go.",
    ],
    tips: [
      "Small, regular taps beat big corrections. Find the tapping rhythm that keeps the glider level.",
      "Aim for the middle of each gap, not the edge closest to you.",
      "Look ahead to the next gap while passing the current one, so you're already at the right height.",
      "Use the ceiling. Brushing the top of the sky is safe, so when in doubt, stay high.",
    ],
    faq: [
      ["What ends the run?", "Hitting a column or the ground. The top of the sky is safe."],
      ["Does it get harder?", "Yes. The speed increases and the gaps narrow the longer you fly."],
    ],
  },
  flipside: {
    about: [
      "Flipside is a gravity-flipping runner. Your runner speeds along a tunnel; tap, click or press Space to flip gravity, dropping from floor to ceiling and back. Holes and spikes line both sides, and falling into a hole or touching a spike ends the run.",
      "You can only flip from a surface; tap early and the flip waits until you land. Every hazard you clear is worth 10 points, and passing spikes close without touching them earns a near-miss bonus that grows with each one in a row. There's no last hazard: the tunnel just keeps getting faster.",
    ],
    tips: [
      "Tap early rather than late. An early tap is held until you land, but a late one can leave you in a hole.",
      "Watch both surfaces. The danger is often on the side you're about to flip to, not the one you're on.",
      "Chase near misses only when it's safe. The bonus grows with every one in a row, but a touch ends the run.",
      "Keep your eyes ahead of the runner — as the tunnel speeds up, reaction time is all about how far ahead you look.",
    ],
    faq: [
      [
        "Why didn't my tap flip the runner?",
        "You can only flip from a surface. A tap in mid-air waits until you land, then flips.",
      ],
      [
        "What is a near miss?",
        "Passing close to spikes without touching them. Each one in a row adds a bigger bonus.",
      ],
    ],
  },
} as const satisfies Record<string, GameGuide>;
