import type { GameGuide } from "./types";

/** Daily puzzles and word games: the same challenge for everyone, new at midnight. */
export const DAILY_GUIDES = {
  guesswork: {
    about: [
      "Guesswork is a daily word game. There is one hidden five-letter word for everyone each day, and you have six guesses to find it. After every guess each letter is marked: filled means it's in the right place, a dashed outline means it's in the word somewhere else, and faded means it isn't in the word at all.",
      "Every guess has to be a real word from the list. Solve it sooner for more points — 600 for a first-guess solve, down to 100 on the sixth. There's one ranked play a day, and a new word arrives at midnight, your time. In Albanian the game is called Gjeje and uses Albanian words, where Ç and Ë are letters of their own and SH or GJ take two squares.",
    ],
    tips: [
      "Open with a word full of common letters — a couple of vowels and frequent consonants like R, S, T, L and N — to rule a lot in or out at once.",
      "If your first guess finds little, use the second to test five completely new letters rather than building on the first.",
      "Mind repeated letters. A letter you guess twice is only marked as many times as the word holds it, so a faded second copy means the letter appears just once.",
      "Once you have three or four letters placed, list every word that fits before guessing. If several fit, guess a word that tells them apart, even if it can't be the answer.",
    ],
    faq: [
      [
        "When does the word change?",
        "At midnight in your own time zone. Everyone gets the same word for their date.",
      ],
      [
        "What happens if I don't find it?",
        "The day scores nothing, and the word is shown. You can try again with the next day's word.",
      ],
    ],
  },
  crossword: {
    about: [
      "The Unbored Crossword is a daily puzzle with original clues. On weekdays it's a mini — a 5×5 grid that takes a minute or two — and on Saturday and Sunday it's a 7×7 midi. Everyone gets the same puzzle each day.",
      "Pick a square and type; pick it again, or tap the clue, to switch between across and down. Speed is the score: a mini solved within 30 seconds is worth 10,000 and a midi within a minute 20,000, slipping 40 points a second after that. If you're stuck, you can check the grid (−50) to see which letters are wrong or reveal a single letter (−100).",
    ],
    tips: [
      "Start with fill-in-the-blank clues. They usually have one obvious answer and give you letters for the crossing words.",
      "Short words first. In a mini every answer crosses several others, so a couple of three-letter answers can unlock the whole grid.",
      "Read clues for their form. A clue in the past tense wants an answer in the past tense, and a plural clue wants a plural.",
      "Checking costs half as much as revealing. If you're unsure about one area, a check is usually the cheaper way to find the problem.",
    ],
    faq: [
      [
        "Why is the weekend crossword bigger?",
        "Saturday and Sunday bring a 7×7 midi instead of the weekday 5×5 mini, with a higher top score to match.",
      ],
      ["Are the clues original?", "Yes. Every clue is written for Unbored."],
    ],
  },
  honeycomb: {
    about: [
      "Honeycomb is a daily word-finding game. Seven letters are arranged on a hive, one in the centre. Make as many words as you can of four letters or more, using only those letters — repeats are allowed — and every word must include the centre letter.",
      "A four-letter word scores 10, longer words 10 a letter, and a word that uses all seven letters earns 70 more. Every day has at least one such word. Your score climbs through the ranks from Egg to Royal. Stop whenever you like: your words are your score, and new letters arrive at midnight, your time.",
    ],
    tips: [
      "Hunt for the all-seven word early. It's worth the most, and finding it reveals which letter combinations go together.",
      "Look for endings. If the hive has letters for -ING, -ED, -ER or -S style endings, every root word you find may give you several more.",
      "Try every letter as a starting point, including the centre one, and say the letters in different orders out loud.",
      "Short words add up. Four-letter words are only 10 points each, but there are usually plenty of them.",
    ],
    faq: [
      [
        "Can I use a letter more than once?",
        "Yes. Letters can repeat within a word, as long as the centre letter is in it.",
      ],
      ["What are the ranks?", "Milestones your score passes, from Egg at the start up to Royal."],
    ],
  },
  meander: {
    about: [
      "Meander is a daily word search with a twist. A grid of letters hides the day's words, all tied to a theme. You find them by dragging through the letters — up, down, left or right, turning as you go — and together the words use every letter on the grid exactly once.",
      "You know the theme and how long each word is. A word can often be traced more than one way, so if letters are left over, tap a placed word to lift it and try another route. Each word scores 100, and filling the grid adds 500 plus 250 for every hint you didn't take: 1,750 for a clean five-word day.",
    ],
    tips: [
      "Start in the corners. A corner letter has only two neighbours, so the word it belongs to is easy to trace.",
      "Use the word lengths. If you know one word is nine letters, look for long winding routes rather than short ones.",
      "Think about the theme before searching. Listing a few likely words first makes them jump out of the grid.",
      "Watch for stranded letters. If placing a word cuts off a small pocket of letters that can't form a word, the route is probably wrong.",
    ],
    faq: [
      [
        "Can words go diagonally?",
        "No. You move up, down, left or right, but a word can turn as often as it needs to.",
      ],
      [
        "What if I find the right word but letters are left over?",
        "The word may need a different route. Tap it to lift it off the grid and trace it another way.",
      ],
    ],
  },
  "then-and-now": {
    about: [
      "Then and Now is a daily history game. Six events around one theme appear in a list; your job is to put them in the order they happened, oldest at the top. Tap two events to swap them, and submit when the order looks right.",
      "Every event in its correct place locks in green and shows its year, and the rest stay for you to move. You have four tries. Each event in place is worth 100 points, and getting all six adds 200 for every try left — 1,200 for a first-try solve. Everyone gets the same timeline, and a new one arrives at midnight, your time.",
    ],
    tips: [
      "Anchor the events you're surest of first: the oldest and the most recent are often easiest to place.",
      "Think about what each event depended on. An invention, a war or a discovery usually had to come before the events it made possible.",
      "Use your locked events. Each year revealed in green narrows down where the remaining events can fit.",
      "Commit to your best full ordering on the first try. Every event you get right locks in, so a bold first attempt tells you the most.",
    ],
    faq: [
      [
        "How many tries do I get?",
        "Four. Every submission locks in the events you placed correctly.",
      ],
      ["Is everyone's timeline the same?", "Yes. There's one theme a day for everyone."],
    ],
  },
  "7-second": {
    about: [
      "7 Second is a daily speed-arithmetic game. You start with seven seconds on the clock and a stream of quick sums, each with three possible answers. A right answer scores 100 and adds 1.5 seconds; a wrong one takes away 2. The game lasts as long as you keep the clock alive.",
      "Everyone on the same date plays the same deck of challenges, so scores are directly comparable. There's one ranked attempt a day, and a new deck arrives at midnight, your time.",
    ],
    tips: [
      "Accuracy beats speed. A wrong answer costs more time than a right one earns, so a careful half-second is cheaper than a mistake.",
      "Eliminate instead of calculating. With only three options, the last digit or whether the answer is odd or even often picks the right one without doing the full sum.",
      "Estimate first. If two answers are far apart, a rough size check settles it instantly.",
      "Keep your eyes on the answers, not the clock. Glancing at the timer costs time you don't have.",
    ],
    faq: [
      [
        "How many times can I play?",
        "One ranked attempt a day. A new deck arrives at midnight, your time.",
      ],
      [
        "Does everyone get the same questions?",
        "Yes. Everyone on the same date plays the same deck.",
      ],
    ],
  },
  "ton-up": {
    about: [
      "Ton Up is a daily trivia-and-arithmetic game. Each day has one category where every answer is worth a number — chemical elements by atomic number, presidents by their number in office, US states by the order they joined, and more. You throw up to three darts by naming answers, and their numbers add up. The goal is exactly 100.",
      "You can stop whenever you like and keep your total; go over 100 and you bust, scoring nothing. Hitting exactly 100 is a ton, worth 1,250 in three darts, 1,500 in two and 1,750 in one. Anything less scores ten times your total. A new category arrives at midnight, your time.",
    ],
    tips: [
      "Throw your biggest dart first. Open with an answer worth 60–80 that you're sure about, then fine-tune with smaller ones.",
      "Know your small numbers. The last dart usually needs to be precise, and in most categories the low numbers are the best known.",
      "Do the maths on standing. A total of 95 already scores 950, while a ton in three darts is 1,250 — worth going for only if you're confident of the exact number you need.",
      "Each answer can only be used once, so plan your three darts before you throw the first.",
    ],
    faq: [
      [
        "What happens if I go over 100?",
        "You bust and the day scores nothing, so stand if you're unsure of your next dart.",
      ],
      [
        "Why is a ton in one dart worth more?",
        "Finding a single answer worth exactly 100 is the hardest way to do it, so it scores the most: 1,750.",
      ],
    ],
  },
  ballpark: {
    about: [
      "Ballpark is a daily price-guessing game. One product is shown, and you have six guesses at its typical US shelf price in dollars. After each guess an arrow tells you whether the real price is higher or lower, and the guess turns amber when you're within 25%.",
      "Land within 5% to win: 600 points on the first guess, down to 100 on the sixth. Everyone gets the same product, there's one ranked play a day, and a new product arrives at midnight, your time.",
    ],
    tips: [
      "Make a confident first guess from what you'd expect to pay in a supermarket or store, rather than a random number.",
      "Narrow down by ratios, not fixed amounts. If $10 is too low and $40 too high, try around $20, not $25 — prices cluster at the low end.",
      "Use the amber zone. Once you're within 25%, small adjustments are enough to land within 5%.",
      "Think in common price points. Shelf prices often end in .99 or .49, so aim near those.",
    ],
    faq: [
      ["What price counts as right?", "Any guess within 5% of the typical US shelf price."],
      [
        "What does amber mean?",
        "Your guess is within 25% of the real price, but not yet within 5%.",
      ],
    ],
  },
  "only-once": {
    about: [
      "Only Once is a daily trivia game with a memory twist. Seven questions all ask about one kind of thing — countries, US states or chemical elements — and every answer can only be used once in the whole game. Start typing and pick your answer from the list; you get 25 seconds a question, after two to read it.",
      "The first questions have plenty of right answers, but the last ones have only a few — and the famous answer you used earlier is often one of them. A wrong or already-used answer is simply turned down so you can try again; only the clock ends your day. Each question is worth 100, and all seven earn 1,000.",
    ],
    tips: [
      "Save the famous answers. On early questions, give a correct but less obvious answer and keep the well-known ones for later.",
      "Read all seven questions in your head as a set: the theme is fixed, so think about which answers might be needed at the end.",
      "Wrong answers cost nothing but time, so if you're unsure, try one — just don't spend the clock on guessing.",
      "Use the two seconds of reading time to plan, before the 25 seconds start.",
    ],
    faq: [
      [
        "What happens if I give a wrong answer?",
        "It's turned down and you can try again. Only running out of time ends a question.",
      ],
      [
        "Can I use the same answer twice?",
        "No — that's the game. Each answer can be used once across all seven questions.",
      ],
    ],
  },
  "dead-reckoning": {
    about: [
      "Dead Reckoning is a daily estimation game of seven 30-second rounds. Each round gives you a number; name something from the suggestions whose real value is as close to it as possible, or type your own estimate.",
      "Accuracy is graded from Dialed (within 1%, worth 1,000) through Sharp (3%), Near (7%), Warm (15%) and Rough (30%) down to a Miss. Speed matters too: the plane sinks while the clock runs, so answering at once earns every point and answering at the buzzer only 40%. One golden round a day counts double, and seven new rounds arrive at midnight, your time.",
    ],
    tips: [
      "Answer quickly when you're confident. A Near answered instantly can beat a Sharp given at the buzzer.",
      "Scan the suggestions first. They often contain something close, and picking is faster than typing.",
      "Think in orders of magnitude before details: first decide whether you're in the thousands or millions, then refine.",
      "Treat the golden round with extra care, since it counts double.",
    ],
    faq: [
      [
        "What happens if the time runs out?",
        "The round scores nothing, so it's always better to give an answer.",
      ],
      ["What is the golden round?", "One of the seven rounds each day counts double."],
    ],
  },
  "tee-time": {
    about: [
      "Tee Time is a daily nine-hole golf game. A new course is laid out every day, and every shot comes down to timing. Tap the course to aim, then tap Swing and tap again to stop the power meter. Pick a club with the arrows; the suggested one reaches the pin at full power. Mind the wind — it pushes every shot.",
      "On the green the putts are automatic: land inside the inner ring for one putt, the outer ring for two, anywhere else for three. Water and out of bounds cost a stroke. Par is worth 300 on every hole, a birdie 400 and an eagle 500. One ranked round a day; a new course arrives at midnight, your time.",
    ],
    tips: [
      "Aim into the wind. If the wind blows left, aim a little right of where you want to land.",
      "Trust the suggested club. It's chosen to reach the pin at full power, so you only need to judge how much less than full to hit.",
      "Play for the inner ring rather than the pin. One putt from the inner ring is the difference between par and a birdie.",
      "Avoid hazards on approach shots. A stroke for water costs more than landing short and safe.",
    ],
    faq: [
      [
        "Do I control putting?",
        "No. Once you're on the green, putts are worked out from where you landed: one inside the inner ring, two in the outer ring, three elsewhere.",
      ],
      ["Is the course the same for everyone?", "Yes. Everyone plays the same nine holes each day."],
    ],
  },
} as const satisfies Record<string, GameGuide>;
