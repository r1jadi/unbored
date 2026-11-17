/**
 * Albanian for Meander: its catalogue text, rules, screens and themes. The words in
 * the grid stay English: the grids are built from English words.
 */
export const sqMeander: Record<string, string> = {
  // ── The catalogue ────────────────────────────────────────────────────────────
  Meander: "Gjarpërimi",
  "Hidden words wind through the grid.": "Fjalë të fshehura gjarpërojnë nëpër rrjetë.",
  "One theme a day and a 5 × 5 grid of letters hiding four or five words from it. Every word winds through side-by-side letters, turning as it goes, and together they use every letter exactly once. You only know the theme and how long each word is.":
    "Një temë në ditë dhe një rrjetë shkronjash 5 × 5 që fsheh katër ose pesë fjalë prej saj. Çdo fjalë gjarpëron nëpër shkronja fqinje, duke u kthyer rrugës, dhe së bashku përdorin çdo shkronjë saktësisht një herë. Di vetëm temën dhe sa e gjatë është çdo fjalë.",
  "Drag through neighbouring letters (up, down, left or right) to trace a word. If it is one of the day's, it stays on the grid. A word can often be traced more than one way, and the wrong route strands letters another word needs: tap a placed word to lift it. Each word is worth 100, and filling the grid adds 500 and 250 for every hint you didn't take: 1,750 for a clean five-word day. One ranked play a day; a new grid arrives at midnight, your time.":
    "Tërhiq gishtin nëpër shkronja fqinje (lart, poshtë, majtas ose djathtas) për të vizatuar një fjalë. Nëse është një nga fjalët e ditës, mbetet në rrjetë. Shpesh një fjalë mund të vizatohet në më shumë se një mënyrë, dhe rruga e gabuar izolon shkronja që i duhen një fjale tjetër: prek një fjalë të vendosur për ta hequr. Çdo fjalë vlen 100, dhe mbushja e rrjetës shton 500 dhe 250 për çdo ndihmë që nuk more: 1,750 për një ditë të pastër me pesë fjalë. Një lojë e renditur në ditë; rrjeta e re vjen në mesnatë, sipas orës tënde.",

  // ── Rules ────────────────────────────────────────────────────────────────────
  "Words that wind": "Fjalë që gjarpërojnë",
  "Find the day's hidden words. Together they use every letter once.":
    "Gjej fjalët e fshehura të ditës. Së bashku përdorin çdo shkronjë një herë.",
  "Drag through the letters": "Tërhiq gishtin nëpër shkronja",
  "up, down, left or right, turning as you go. A word of the day's theme stays on the grid.":
    "lart, poshtë, majtas ose djathtas, duke u kthyer rrugës. Një fjalë e temës së ditës mbetet në rrjetë.",
  "Every letter, once.": "Çdo shkronjë, një herë.",
  "The words fill the grid between them. You know the theme and how long each word is.":
    "Fjalët e mbushin rrjetën mes tyre. Di temën dhe sa e gjatë është çdo fjalë.",
  "Stuck letters?": "Shkronja të bllokuara?",
  "A word can often be traced more than one way. Tap a placed word to lift it and try another route.":
    "Shpesh një fjalë mund të vizatohet në më shumë se një mënyrë. Prek një fjalë të vendosur për ta hequr dhe provo një rrugë tjetër.",
  "100 a word,": "100 për çdo fjalë,",
  "and filling the grid adds 500 and 250 for every hint you didn't take: 1,750 for a clean five-word day. A new grid arrives at midnight, your time.":
    "dhe mbushja e rrjetës shton 500 dhe 250 për çdo ndihmë që nuk more: 1,750 për një ditë të pastër me pesë fjalë. Rrjeta e re vjen në mesnatë, sipas orës tënde.",

  // ── Screens ──────────────────────────────────────────────────────────────────
  "Play today's grid": "Luaj rrjetën e sotme",
  "Fetching today's grid…": "Po merret rrjeta e sotme…",
  "You've played today's grid": "E ke luajtur rrjetën e sotme",
  "Every word, no hints!": "Çdo fjalë, pa ndihma!",
  "Grid filled with 1 hint": "Rrjeta u mbush me 1 ndihmë",
  "Grid filled with {n} hints": "Rrjeta u mbush me {n} ndihma",
  "{n} of {total} words": "{n} nga {total} fjalë",
  Hints: "Ndihma",
  "The words": "Fjalët",
  "Letter grid": "Rrjeta e shkronjave",
  "Words have at least four letters.": "Fjalët kanë të paktën katër shkronja.",
  "{word}!": "{word}!",
  "Already on the grid.": "Është tashmë në rrjetë.",
  "{word} isn't one of today's words.": "{word} nuk është nga fjalët e sotme.",
  "That's the most moves a day allows. Stop to keep your words.":
    "Kaq lëvizje lejon një ditë. Ndalo për të mbajtur fjalët e tua.",
  "{word}, placed. Lift it": "{word}, e vendosur. Hiqe",
  "{word}, from a hint": "{word}, nga një ndihmë",
  "A word of {n} letters": "Një fjalë me {n} shkronja",
  "Hint ({n} left)": "Ndihmë ({n} të mbetura)",
  Clear: "Pastro",
  "Grid filled!": "Rrjeta u mbush!",

  // ── Themes ───────────────────────────────────────────────────────────────────
  "Fruit bowl": "Tasi me fruta",
  Weather: "Moti",
  "Under the sea": "Nën det",
  "In the kitchen": "Në kuzhinë",
  Planets: "Planetët",
  Colours: "Ngjyrat",
  "The orchestra": "Orkestra",
  "On the farm": "Në fermë",
  "The body": "Trupi",
  Trees: "Pemët",
  Breakfast: "Mëngjesi",
  "Creepy crawlies": "Insektet",
  Vegetables: "Perimet",
  Birds: "Zogjtë",
  Desserts: "Ëmbëlsirat",
  "The toolbox": "Kutia e veglave",
  "Wrap up warm": "Vishu ngrohtë",
  "Outer space": "Hapësira",
  Jobs: "Profesionet",
  Gems: "Gurët e çmuar",
  Shapes: "Format",
  Camping: "Kampingu",
  "Small pets": "Kafshë të vogla shtëpiake",
  "The bathroom": "Banjoja",
  "Getting about": "Mjetet e transportit",
  Landscapes: "Peizazhet",
  "Italian food": "Ushqimi italian",
  "The office": "Zyra",
  "The spice rack": "Erëzat",
  Dances: "Vallet",
  Chess: "Shahu",
  Flowers: "Lulet",
  "At the beach": "Në plazh",
  Winter: "Dimri",
  Pirates: "Piratët",
  "The circus": "Cirku",
  "Coffee shop": "Kafeneja",
  "Fairy tales": "Përrallat",
  Bakery: "Furra",
};
