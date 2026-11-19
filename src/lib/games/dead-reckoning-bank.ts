/**
 * Dead Reckoning's bank: the lists a round asks you to name from, the questions it
 * asks you to estimate, and the 120 days built from them.
 *
 * Every value is a whole number in the unit the round names, as commonly cited
 * (Wikipedia's figures, in 2026): heights and lengths in metres or kilometres,
 * areas in square kilometres, years as years AD. Day `d` is puzzle `d mod n`.
 *
 * The puzzles are generated here, once, by a seeded walk that is the same on every
 * machine: four "name it" rounds from four different lists, three estimates, in a
 * shuffled order, one of them golden. Only numbers reach the database —
 * `public.dead_reckoning_values` and `public.dead_reckoning_puzzle` in
 * `supabase/migrations/20270121120000_dead_reckoning_sessions.sql` — and
 * `dead-reckoning.test.ts` fails if the two copies drift. Rewrite them with
 * `bun scripts/generate-daily-banks.ts --write` after changing anything here.
 * Changing a list or the walk changes the days it built, so only ever append:
 * new entries and questions at the end of their lists.
 */

/** How an answer's error is measured: relative to the target, or in years. */
export type Scale = "ratio" | "year";

export type Entry = {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly value: number;
};

export type Category = {
  readonly id: string;
  /** "a mountain", for the input's placeholder. */
  readonly noun: string;
  /** The question, with `{target}` for the number. */
  readonly prompt: string;
  /** The unit after a value: "m", "km²"; empty for years. */
  readonly unit: string;
  readonly scale: Scale;
  readonly emoji: string;
  readonly entries: readonly Entry[];
};

export type Estimate = {
  readonly question: string;
  readonly answer: number;
  readonly unit: string;
  readonly scale: Scale;
};

const e = (name: string, value: number, ...aliases: string[]): Entry =>
  aliases.length > 0 ? { name, value, aliases } : { name, value };

export const CATEGORIES: readonly Category[] = [
  {
    id: "mountains",
    noun: "a mountain",
    prompt: "Name a mountain whose height is closest to {target} m",
    unit: "m",
    scale: "ratio",
    emoji: "🏔️",
    entries: [
      e("Mount Everest", 8849, "Everest", "Sagarmatha", "Chomolungma"),
      e("K2", 8611, "Godwin-Austen"),
      e("Kangchenjunga", 8586),
      e("Lhotse", 8516),
      e("Makalu", 8485),
      e("Cho Oyu", 8188),
      e("Dhaulagiri", 8167),
      e("Manaslu", 8163),
      e("Nanga Parbat", 8126),
      e("Annapurna", 8091),
      e("Shishapangma", 8027),
      e("Aconcagua", 6961),
      e("Ojos del Salado", 6893),
      e("Huascarán", 6768),
      e("Illimani", 6438),
      e("Chimborazo", 6263),
      e("Denali", 6190, "Mount McKinley"),
      e("Mount Logan", 5959, "Logan"),
      e("Kilimanjaro", 5895, "Mount Kilimanjaro"),
      e("Cotopaxi", 5897),
      e("Mount Elbrus", 5642, "Elbrus"),
      e("Pico de Orizaba", 5636, "Citlaltépetl", "Orizaba"),
      e("Mount Damavand", 5610, "Damavand"),
      e("Popocatépetl", 5426),
      e("Mount Kenya", 5199),
      e("Mount Ararat", 5137, "Ararat"),
      e("Mount Stanley", 5109),
      e("Mount Kazbek", 5054, "Kazbek"),
      e("Mount Vinson", 4892, "Vinson Massif", "Vinson"),
      e("Puncak Jaya", 4884, "Carstensz Pyramid"),
      e("Mont Blanc", 4806, "Monte Bianco"),
      e("Monte Rosa", 4634, "Dufourspitze"),
      e("Ras Dashen", 4550),
      e("Matterhorn", 4478, "Monte Cervino"),
      e("Mount Whitney", 4421, "Whitney"),
      e("Mount Elbert", 4401, "Elbert"),
      e("Mount Rainier", 4392, "Rainier", "Tahoma"),
      e("Mount Shasta", 4322, "Shasta"),
      e("Pikes Peak", 4302),
      e("Mauna Kea", 4207),
      e("Toubkal", 4167, "Jebel Toubkal"),
      e("Jungfrau", 4158),
      e("Mount Kinabalu", 4095, "Kinabalu"),
      e("Eiger", 3967),
      e("Grossglockner", 3798),
      e("Mount Erebus", 3794, "Erebus"),
      e("Mount Fuji", 3776, "Fuji", "Fujisan"),
      e("Aoraki / Mount Cook", 3724, "Mount Cook", "Aoraki"),
      e("Teide", 3715, "Mount Teide", "Pico del Teide"),
      e("Mount Hood", 3429, "Hood"),
      e("Mount Etna", 3357, "Etna"),
      e("Zugspitze", 2962),
      e("Mount Olympus", 2918, "Olympus", "Mytikas"),
      e("Mount St. Helens", 2549, "Saint Helens", "St Helens"),
      e("Mount Sinai", 2285, "Jebel Musa"),
      e("Mount Kosciuszko", 2228, "Kosciuszko"),
      e("Mount Washington", 1917),
      e("Ben Nevis", 1345),
      e("Mount Vesuvius", 1281, "Vesuvius"),
      e("Snowdon", 1085, "Yr Wyddfa"),
    ],
  },
  {
    id: "rivers",
    noun: "a river",
    prompt: "Name a river whose length is closest to {target} km",
    unit: "km",
    scale: "ratio",
    emoji: "🌊",
    entries: [
      e("Nile", 6650),
      e("Amazon", 6400),
      e("Yangtze", 6300, "Chang Jiang"),
      e("Yellow River", 5464, "Huang He"),
      e("Paraná", 4880),
      e("Congo", 4700, "Zaire"),
      e("Lena", 4400),
      e("Mekong", 4350),
      e("Irtysh", 4248),
      e("Niger", 4180),
      e("Missouri", 3767),
      e("Mississippi", 3730),
      e("Ob", 3650),
      e("Volga", 3531),
      e("Yenisei", 3487),
      e("Yukon", 3185),
      e("Indus", 3180),
      e("Rio Grande", 3051, "Río Bravo"),
      e("São Francisco", 2914),
      e("Brahmaputra", 2900),
      e("Danube", 2850, "Donau"),
      e("Amur", 2824),
      e("Salween", 2815),
      e("Euphrates", 2800),
      e("Zambezi", 2574),
      e("Ganges", 2525, "Ganga"),
      e("Murray", 2508),
      e("Tocantins", 2450),
      e("Ural", 2428),
      e("Colorado", 2330),
      e("Dnieper", 2201, "Dnipro"),
      e("Orinoco", 2140),
      e("Columbia", 2000),
      e("Don", 1870),
      e("Tigris", 1850),
      e("Limpopo", 1750),
      e("Mackenzie", 1738),
      e("Ohio", 1579),
      e("Rhine", 1233, "Rhein"),
      e("Elbe", 1094),
      e("Vistula", 1047, "Wisła"),
      e("Tagus", 1007, "Tajo", "Tejo"),
      e("Loire", 1006),
      e("Seine", 777),
      e("Po", 652),
      e("Thames", 346),
    ],
  },
  {
    id: "structures",
    noun: "a building or structure",
    prompt: "Name a building or structure whose height is closest to {target} m",
    unit: "m",
    scale: "ratio",
    emoji: "🏙️",
    entries: [
      e("Burj Khalifa", 828),
      e("Merdeka 118", 679),
      e("Tokyo Skytree", 634, "Skytree"),
      e("Shanghai Tower", 632),
      e("Abraj Al-Bait Clock Tower", 601, "Makkah Royal Clock Tower", "Mecca Clock Tower"),
      e("Ping An Finance Centre", 599),
      e("Lotte World Tower", 555),
      e("CN Tower", 553),
      e("One World Trade Center", 541, "Freedom Tower"),
      e("Ostankino Tower", 540),
      e("Guangzhou CTF Finance Centre", 530),
      e("Taipei 101", 508),
      e("Shanghai World Financial Center", 492),
      e("International Commerce Centre", 484, "ICC Hong Kong"),
      e("Oriental Pearl Tower", 468),
      e("Lakhta Center", 462),
      e("Petronas Towers", 452, "Petronas Twin Towers"),
      e("Willis Tower", 442, "Sears Tower"),
      e("Milad Tower", 435),
      e("Empire State Building", 381, "Empire State"),
      e("Berlin TV Tower", 368, "Fernsehturm"),
      e("Bank of China Tower", 367),
      e("Eiffel Tower", 330, "Tour Eiffel"),
      e("Burj Al Arab", 321),
      e("Chrysler Building", 319),
      e("The Shard", 310, "Shard"),
      e("Transamerica Pyramid", 260),
      e("Golden Gate Bridge towers", 227, "Golden Gate Bridge"),
      e("Gateway Arch", 192),
      e("Space Needle", 184),
      e("30 St Mary Axe", 180, "The Gherkin", "Gherkin"),
      e("Washington Monument", 169),
      e("Ulm Minster", 162, "Ulmer Münster"),
      e("Cologne Cathedral", 157, "Kölner Dom"),
      e("Great Pyramid of Giza", 139, "Pyramid of Khufu", "Great Pyramid"),
      e("St. Peter's Basilica", 137, "Saint Peter's Basilica"),
      e("Big Ben", 96, "Elizabeth Tower"),
      e("Statue of Liberty", 93),
      e("Flatiron Building", 87),
      e("Leaning Tower of Pisa", 56, "Tower of Pisa"),
    ],
  },
  {
    id: "people",
    noun: "a famous person",
    prompt: "Name a famous person born as close as you can to {target}",
    unit: "",
    scale: "year",
    emoji: "🎂",
    entries: [
      e("Dante Alighieri", 1265, "Dante"),
      e("Marco Polo", 1254),
      e("Joan of Arc", 1412, "Jeanne d'Arc"),
      e("Christopher Columbus", 1451, "Columbus"),
      e("Leonardo da Vinci", 1452, "Leonardo"),
      e("Nicolaus Copernicus", 1473, "Copernicus"),
      e("Michelangelo", 1475),
      e("Henry VIII", 1491),
      e("Elizabeth I", 1533, "Queen Elizabeth I"),
      e("William Shakespeare", 1564, "Shakespeare"),
      e("Galileo Galilei", 1564, "Galileo"),
      e("Rembrandt", 1606, "Rembrandt van Rijn"),
      e("Isaac Newton", 1643, "Newton"),
      e("Johann Sebastian Bach", 1685, "Bach"),
      e("George Washington", 1732),
      e("Wolfgang Amadeus Mozart", 1756, "Mozart"),
      e("Napoleon Bonaparte", 1769, "Napoleon"),
      e("Ludwig van Beethoven", 1770, "Beethoven"),
      e("Jane Austen", 1775),
      e("Charles Darwin", 1809, "Darwin"),
      e("Abraham Lincoln", 1809, "Lincoln"),
      e("Frédéric Chopin", 1810, "Chopin"),
      e("Charles Dickens", 1812, "Dickens"),
      e("Ada Lovelace", 1815),
      e("Karl Marx", 1818, "Marx"),
      e("Queen Victoria", 1819, "Victoria"),
      e("Florence Nightingale", 1820),
      e("Louis Pasteur", 1822, "Pasteur"),
      e("Leo Tolstoy", 1828, "Tolstoy"),
      e("Mark Twain", 1835, "Samuel Clemens"),
      e("Claude Monet", 1840, "Monet"),
      e("Thomas Edison", 1847, "Edison"),
      e("Vincent van Gogh", 1853, "Van Gogh"),
      e("Nikola Tesla", 1856, "Tesla"),
      e("Sigmund Freud", 1856, "Freud"),
      e("Marie Curie", 1867, "Curie"),
      e("Mahatma Gandhi", 1869, "Gandhi"),
      e("Winston Churchill", 1874, "Churchill"),
      e("Albert Einstein", 1879, "Einstein"),
      e("Pablo Picasso", 1881, "Picasso"),
      e("Agatha Christie", 1890),
      e("Amelia Earhart", 1897),
      e("Walt Disney", 1901, "Disney"),
      e("Salvador Dalí", 1904, "Dali"),
      e("Frida Kahlo", 1907, "Kahlo"),
      e("Mother Teresa", 1910, "Teresa of Calcutta"),
      e("Alan Turing", 1912, "Turing"),
      e("Nelson Mandela", 1918, "Mandela"),
      e("Marilyn Monroe", 1926),
      e("Queen Elizabeth II", 1926, "Elizabeth II"),
      e("Martin Luther King Jr.", 1929, "MLK", "Martin Luther King"),
      e("Neil Armstrong", 1930, "Armstrong"),
      e("Elvis Presley", 1935, "Elvis"),
      e("John Lennon", 1940, "Lennon"),
      e("Pelé", 1940, "Pele"),
      e("Muhammad Ali", 1942, "Cassius Clay"),
      e("Steve Jobs", 1955, "Jobs"),
      e("Bill Gates", 1955, "Gates"),
      e("Michael Jackson", 1958),
    ],
  },
  {
    id: "countries",
    noun: "a country",
    prompt: "Name a country whose area is closest to {target} km²",
    unit: "km²",
    scale: "ratio",
    emoji: "🗺️",
    entries: [
      e("Russia", 17098246),
      e("Canada", 9984670),
      e("United States", 9833520, "USA", "US", "America"),
      e("China", 9596961),
      e("Brazil", 8515767),
      e("Australia", 7692024),
      e("India", 3287263),
      e("Argentina", 2780400),
      e("Kazakhstan", 2724900),
      e("Algeria", 2381741),
      e("DR Congo", 2344858, "Democratic Republic of the Congo"),
      e("Saudi Arabia", 2149690),
      e("Mexico", 1964375),
      e("Indonesia", 1904569),
      e("Sudan", 1886068),
      e("Libya", 1759540),
      e("Iran", 1648195),
      e("Mongolia", 1564110),
      e("Peru", 1285216),
      e("Chad", 1284000),
      e("Niger", 1267000),
      e("Angola", 1246700),
      e("Mali", 1240192),
      e("South Africa", 1221037),
      e("Colombia", 1141748),
      e("Ethiopia", 1104300),
      e("Bolivia", 1098581),
      e("Egypt", 1002450),
      e("Tanzania", 947303),
      e("Nigeria", 923768),
      e("Venezuela", 916445),
      e("Pakistan", 881913),
      e("Turkey", 783562, "Türkiye"),
      e("Chile", 756102),
      e("Myanmar", 676578, "Burma"),
      e("Afghanistan", 652230),
      e("Ukraine", 603550),
      e("Madagascar", 587041),
      e("Kenya", 580367),
      e("Thailand", 513120),
      e("Spain", 505990),
      e("Sweden", 450295),
      e("Morocco", 446550),
      e("Iraq", 438317),
      e("Norway", 385207),
      e("Japan", 377975),
      e("Germany", 357022),
      e("Finland", 338424),
      e("Vietnam", 331212),
      e("Poland", 312696),
      e("Italy", 301340),
      e("Philippines", 300000),
      e("New Zealand", 268021),
      e("United Kingdom", 242495, "UK", "Britain"),
      e("Romania", 238391),
      e("Greece", 131957),
      e("Bulgaria", 110994),
      e("Cuba", 109884),
      e("Iceland", 103000),
      e("South Korea", 100210, "Korea"),
      e("Hungary", 93030),
      e("Portugal", 92212),
      e("Austria", 83871),
      e("Czech Republic", 78871, "Czechia"),
      e("Ireland", 70273),
      e("Croatia", 56594),
      e("Netherlands", 41850, "Holland"),
      e("Switzerland", 41285),
      e("Belgium", 30528),
      e("Albania", 28748, "Shqipëria"),
      e("North Macedonia", 25713, "Macedonia"),
      e("Slovenia", 20271),
      e("Montenegro", 13812),
      e("Jamaica", 10991),
      e("Kosovo", 10887),
      e("Luxembourg", 2586),
      e("Malta", 316),
    ],
  },
];

const q = (question: string, answer: number, unit = "", scale: Scale = "ratio"): Estimate => ({
  question,
  answer,
  unit,
  scale,
});
const year = (question: string, answer: number): Estimate => q(question, answer, "", "year");

export const ESTIMATES: readonly Estimate[] = [
  q("How many bones are in the adult human body?", 206),
  q("How many keys does a standard piano have?", 88),
  q("How many member states does the United Nations have?", 193),
  q("How fast does sound travel through air at sea level, in metres per second?", 343, "m/s"),
  q("How far is the Moon from Earth on average, in kilometres?", 384400, "km"),
  q("How long is Earth's equator, in kilometres?", 40075, "km"),
  q("At what temperature does water boil at sea level, in °F?", 212, "°F"),
  q("How many squares are on a chessboard?", 64),
  q("How many chemical elements are in the periodic table?", 118),
  q("How many minutes are in a week?", 10080),
  q("How many seconds are in a day?", 86400),
  q("How long is a marathon, in metres?", 42195, "m"),
  q("How many days does Mars take to orbit the Sun?", 687),
  q("How fast does light travel in a vacuum, in kilometres per second?", 299792, "km/s"),
  q("How deep is the Challenger Deep in the Mariana Trench, in metres?", 10935, "m"),
  q("How many bones are in one human hand, wrist included?", 27),
  q("How far is the Sun from Earth on average, in millions of kilometres?", 150),
  q("What is Earth's diameter, in kilometres?", 12742, "km"),
  q("What is the Moon's diameter, in kilometres?", 3474, "km"),
  q("What is the Sun's diameter, in kilometres?", 1391400, "km"),
  q("How many lines does a sonnet have?", 14),
  q("What is the maximum break in snooker?", 147),
  q("What is a perfect score in ten-pin bowling?", 300),
  q("How high is a regulation basketball hoop, in centimetres?", 305, "cm"),
  q(
    "How long is the Great Wall of China in total, in kilometres, by China's 2012 survey?",
    21196,
    "km",
  ),
  q("How many hours are in a 365-day year?", 8760),
  q("How many bones make up the adult human skull?", 22),
  q("How many chromosomes does a typical human cell have?", 46),
  q("What is the freezing point of water, in kelvin, to the nearest whole number?", 273, "K"),
  q("How long is the Panama Canal, in kilometres?", 82, "km"),
  q("How far is London from New York as the crow flies, in kilometres?", 5570, "km"),
  q("How many floors above ground does the Burj Khalifa have?", 163),
  q("How many pixels are in one full-HD (1920 × 1080) frame?", 2073600),
  q("How many metres are in a mile?", 1609, "m"),
  q("How many feet are in a mile?", 5280, "ft"),
  q("How many grams are in a pound?", 454, "g"),
  q("How many rooms does Buckingham Palace have?", 775),
  q("How many FIFA men's World Cups were played up to and including 2022?", 22),
  q("How many teeth does an adult human have, wisdom teeth included?", 32),
  q("How many days are in a leap year?", 366),
  year("In what year did humans first land on the Moon?", 1969),
  year("In what year did the Berlin Wall fall?", 1989),
  year("In what year did the Titanic sink?", 1912),
  year("In what year did the French Revolution begin?", 1789),
  year("In what year was the US Declaration of Independence signed?", 1776),
  year("In what year did Columbus first reach the Americas?", 1492),
  year("In what year did World War I begin?", 1914),
  year("In what year did World War II end?", 1945),
  year("In what year was the first iPhone released?", 2007),
  year("In what year was Magna Carta sealed?", 1215),
  year("In what year was the Battle of Hastings?", 1066),
  year("In what year did the Wright brothers make their first powered flight?", 1903),
  year("In what year did Alexander Graham Bell patent the telephone?", 1876),
  year("In what year did Constantinople fall to the Ottomans?", 1453),
  year("In what year was the Chernobyl disaster?", 1986),
  year("In what year did Alexander Fleming discover penicillin?", 1928),
  year("In what year was the structure of DNA published by Watson and Crick?", 1953),
  year("In what year was the first FIFA World Cup played?", 1930),
  year("In what year was Sputnik 1 launched?", 1957),
  year("In what year did the Russian Revolution take place?", 1917),
  year("In what year was the Great Fire of London?", 1666),
  year("In what year did the American Civil War begin?", 1861),
  year("In what year did Martin Luther post his Ninety-five Theses?", 1517),
  year("In what year did Albania declare independence?", 1912),
  year("In what year did Kosovo declare independence?", 2008),
  year("In what year were the first modern Olympic Games held?", 1896),
  year("In what year did the Panama Canal open?", 1914),
  year("In what year was the Eiffel Tower completed?", 1889),
  year("In what year was the Statue of Liberty dedicated?", 1886),
  year("In what year did euro banknotes and coins enter circulation?", 2002),
  year("In what year was Facebook launched?", 2004),
  year("In what year was Google founded?", 1998),
  year("In what year was the Hubble Space Telescope launched?", 1990),
  year("In what year did Mount Vesuvius bury Pompeii?", 79),
  year("In what year was the Treaty of Versailles signed?", 1919),
  year("In what year was the Wall Street Crash?", 1929),
  year("In what year did Darwin publish On the Origin of Species?", 1859),
  year("In what year was the Battle of Waterloo?", 1815),
  year("In what year did the Suez Canal open?", 1869),
  year("In what year was the first Star Wars film released?", 1977),
  year("In what year was Nelson Mandela released from prison?", 1990),
  year("In what year was Pluto discovered?", 1930),
  year("In what year was Pluto reclassified as a dwarf planet?", 2006),
  year("In what year did the World Health Organization declare COVID-19 a pandemic?", 2020),
  year("In what year did the United Kingdom vote to leave the EU?", 2016),
];

export const ROUNDS = 7;
export const NAME_ROUNDS = 4;
/** The largest estimate a move can carry. */
export const MAX_ESTIMATE = 9_999_999;

export type Round =
  | { readonly kind: "name"; readonly category: number; readonly target: number }
  | { readonly kind: "estimate"; readonly estimate: number };

export type Puzzle = {
  readonly rounds: readonly Round[];
  /** The golden round's place, 0 to 6: its points count double. */
  readonly golden: number;
};

/** A small seeded generator (mulberry32), the same on every machine. */
function generator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * A round number near an entry's value, so the board asks for "6,200 m", not
 * "6,190 m": the fewest significant figures within half a percent, or for a year
 * the nearest ten when it is within a year.
 */
export function niceTarget(value: number, scale: Scale): number {
  if (scale === "year") {
    const ten = Math.round(value / 10) * 10;
    return Math.abs(ten - value) <= 1 ? ten : value;
  }
  for (let figures = 1; figures <= 8; figures++) {
    const step = 10 ** Math.max(0, Math.floor(Math.log10(value)) + 1 - figures);
    const rounded = Math.round(value / step) * step;
    if (rounded > 0 && Math.abs(rounded - value) * 1000 <= 5 * value) return rounded;
  }
  return value;
}

/** A deck that deals every card once, reshuffled, before any comes round again. */
function deck(size: number, random: () => number): () => number {
  let cards: number[] = [];
  return () => {
    if (cards.length === 0)
      cards = shuffled(
        Array.from({ length: size }, (_, i) => i),
        random,
      );
    return cards.pop()!;
  };
}

function buildPuzzles(count: number): Puzzle[] {
  const random = generator(0x0dead7ec);
  const entryDecks = CATEGORIES.map((category) => deck(category.entries.length, random));
  const numeric = ESTIMATES.flatMap((estimate, i) => (estimate.scale === "ratio" ? [i] : []));
  const years = ESTIMATES.flatMap((estimate, i) => (estimate.scale === "year" ? [i] : []));
  const numericDeck = deck(numeric.length, random);
  const yearDeck = deck(years.length, random);
  const puzzles: Puzzle[] = [];
  for (let p = 0; p < count; p++) {
    // Four of the five lists, a different one left out each day.
    const categories = CATEGORIES.map((_, i) => i).filter((i) => i !== p % CATEGORIES.length);
    const names: Round[] = categories.map((category) => {
      const entry = CATEGORIES[category]!.entries[entryDecks[category]!()]!;
      return {
        kind: "name",
        category,
        target: niceTarget(entry.value, CATEGORIES[category]!.scale),
      };
    });
    // Three estimates: two numbers and a year, or one number and two years.
    const twoNumbers = p % 2 === 0;
    const picks: number[] = [];
    const draw = (from: readonly number[], next: () => number) => {
      let pick = from[next()]!;
      // A deck reshuffled between two draws could deal the same question twice.
      while (picks.includes(pick)) pick = from[next()]!;
      picks.push(pick);
    };
    draw(numeric, numericDeck);
    if (twoNumbers) draw(numeric, numericDeck);
    else draw(years, yearDeck);
    draw(years, yearDeck);
    const estimates: Round[] = picks.map((estimate) => ({ kind: "estimate", estimate }));
    const rounds = shuffled([...names, ...estimates], random);
    puzzles.push({ rounds, golden: Math.floor(random() * ROUNDS) });
  }
  return puzzles;
}

export const PUZZLES: readonly Puzzle[] = buildPuzzles(120);
