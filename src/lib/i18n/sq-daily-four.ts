/**
 * Albanian for the four daily games added together — Ton Up, Ballpark, Only Once
 * and Tee Time: their catalogue text, their rules and their screens. Answers
 * (countries, elements, products…) stay in English, as Deep Cut's do.
 */
export const sqDailyFour: Record<string, string> = {
  // ── Shared daily screens ─────────────────────────────────────────────────────
  "Couldn't start today's game": "Loja e sotme nuk nisi dot",
  "A new one arrives in {n}{minutes} min.": "E reja vjen pas {n}{minutes} min.",
  "Type an answer…": "Shkruaj një përgjigje…",
  Suggestions: "Sugjerime",

  // ── Ton Up ───────────────────────────────────────────────────────────────────
  "Ton Up": "Njëqindëshi",
  "Three darts. Hit exactly 100.": "Tri shigjeta. Godit saktë 100.",
  "One category a day — chemical elements, US presidents, calling codes — and every answer is worth a number: an element its atomic number, a president their number in office. Name up to three answers to add up to exactly 100. Go over and you bust.":
    "Një kategori në ditë — elemente kimike, presidentë të SHBA-së, prefikse telefonike — dhe çdo përgjigje vlen një numër: një element numrin e vet atomik, një president numrin e mandatit. Thuaj deri në tri përgjigje që të mblidhen saktë 100. Po e kalove, digjesh.",
  "Type an answer and pick it from the list: its number is added to your total. Up to three darts, each answer once, and you can stand whenever you like. Over 100 is a bust and scores nothing. Your score is your total; exactly 100 is a ton, worth 1,250 in three darts, 1,500 in two and 1,750 in one. One ranked play a day; a new category arrives at midnight, your time.":
    "Shkruaj një përgjigje dhe zgjidhe nga lista: numri i saj i shtohet totalit. Deri në tri shigjeta, secila përgjigje një herë, dhe mund të ndalesh kur të duash. Mbi 100 digjesh dhe nuk merr asgjë. Pikët janë totali yt; saktë 100 është njëqindësh, që vlen 1,250 me tri shigjeta, 1,500 me dy dhe 1,750 me një. Një lojë e renditur në ditë; kategoria e re vjen në mesnatë, sipas orës tënde.",
  "Three darts at 100": "Tri shigjeta te 100",
  "Every answer is worth a number. Name up to three to hit exactly 100.":
    "Çdo përgjigje vlen një numër. Thuaj deri në tri për të goditur saktë 100.",
  "One category a day": "Një kategori në ditë",
  "— elements by atomic number, presidents by their number in office, states by when they joined, and more.":
    "— elementet sipas numrit atomik, presidentët sipas numrit të mandatit, shtetet sipas radhës së anëtarësimit, e të tjera.",
  "Throw a dart": "Hidh një shigjetë",
  "by typing an answer and picking it from the list. Its number is added to your total. Each answer once, three darts at most.":
    "duke shkruar një përgjigje dhe duke e zgjedhur nga lista. Numri i saj i shtohet totalit. Secila përgjigje një herë, jo më shumë se tri shigjeta.",
  "Stand or bust.": "Ndalu ose digju.",
  "Stop whenever you like and keep your total. Go over 100 and you bust: nothing scores.":
    "Ndalu kur të duash dhe mbaje totalin. Po e kalove 100-ën digjesh: nuk merr asgjë.",
  "Exactly 100 is a ton": "Saktë 100 është njëqindësh",
  "— 1,250 in three darts, 1,500 in two, 1,750 in one. Anything less scores ten times your total. A new category arrives at midnight, your time.":
    "— 1,250 me tri shigjeta, 1,500 me dy, 1,750 me një. Çdo gjë më pak jep dhjetëfishin e totalit. Kategoria e re vjen në mesnatë, sipas orës tënde.",
  "Play today's category": "Luaj kategorinë e sotme",
  "Fetching today's category…": "Po merret kategoria e sotme…",
  "You've played today's category": "E ke luajtur kategorinë e sotme",
  "Today's category": "Kategoria e sotme",
  "Dart {n} of {max}": "Shigjeta {n} nga {max}",
  "{n} to go": "Edhe {n}",
  "Bust!": "U dogje!",
  "A ton!": "Njëqindësh!",
  Throw: "Hidh",
  "(thrown)": "(e hedhur)",
  "Nothing in today's category matches that.": "Asgjë në kategorinë e sotme nuk përputhet.",
  "You've already thrown {name}.": "E ke hedhur tashmë {name}.",
  "Stand on {total} ({points})": "Ndalu te {total} ({points})",
  "A ton in {n}!": "Njëqindësh me {n}!",
  "Bust on {total}": "U dogje te {total}",
  "Stood on {total}": "U ndale te {total}",
  Bust: "U dogj",
  Darts: "Shigjeta",
  Total: "Totali",
  "Chemical elements": "Elemente kimike",
  "US presidents": "Presidentë të SHBA-së",
  "US states": "Shtete të SHBA-së",
  "Country calling codes": "Prefikse telefonike të shteteve",
  "Days of the year": "Ditët e vitit",
  "The periodic table: hydrogen is 1, oganesson 118.":
    "Tabela periodike: hidrogjeni është 1, oganesoni 118.",
  "Washington is 1; Cleveland and Trump count once per term.":
    "Uashingtoni është 1; Klivlendi dhe Trampi numërohen një herë për çdo mandat.",
  "Delaware joined first (1), Hawaii last (50).":
    "Delaware u bashkua i pari (1), Havai i fundit (50).",
  "The international code you dial before the number: +1, +44, +355…":
    "Prefiksi ndërkombëtar që formon para numrit: +1, +44, +355…",
  "Fixed-date days by their day of a non-leap year: 1 January is 1.":
    "Ditë me datë fikse sipas radhës në një vit jo të brishtë: 1 janari është 1.",

  // ── Ballpark ─────────────────────────────────────────────────────────────────
  Ballpark: "Me Sy",
  "Guess the price. Six tries.": "Gjej çmimin. Gjashtë përpjekje.",
  "One product a day, the same for everyone, and six guesses at what it costs on a typical US shelf. Every guess tells you higher or lower, and whether you are close. Land within 5% to win.":
    "Një produkt në ditë, i njëjti për të gjithë, dhe gjashtë përpjekje për sa kushton në një raft tipik në SHBA. Çdo përpjekje të thotë më lart apo më poshtë, dhe nëse je afër. Bjer brenda 5% për të fituar.",
  "Type a price and press Guess. An arrow says whether the real price is higher or lower; amber means you are within 25%. Get within 5% to win: 600 for the first guess, down to 100 on the sixth. One ranked play a day; a new product arrives at midnight, your time.":
    "Shkruaj një çmim dhe shtyp Provo. Një shigjetë tregon nëse çmimi i vërtetë është më lart apo më poshtë; ngjyra portokalli do të thotë që je brenda 25%. Bjer brenda 5% për të fituar: 600 në përpjekjen e parë, deri në 100 në të gjashtën. Një lojë e renditur në ditë; produkti i ri vjen në mesnatë, sipas orës tënde.",
  "What does it cost?": "Sa kushton?",
  "One product a day. Six guesses at its price.":
    "Një produkt në ditë. Gjashtë përpjekje për çmimin.",
  "Type a price": "Shkruaj një çmim",
  "in dollars and press Guess. It's a typical US shelf price for the item shown.":
    "në dollarë dhe shtyp Provo. Është një çmim tipik rafti në SHBA për artikullin e treguar.",
  "Follow the arrow.": "Ndiq shigjetën.",
  "Up means the price is higher, down means lower. Amber means you're within 25%.":
    "Lart do të thotë që çmimi është më i lartë, poshtë më i ulët. Portokallia do të thotë që je brenda 25%.",
  "Within 5% wins": "Brenda 5% fiton",
  "One product a day": "Një produkt në ditë",
  "for everyone, and one ranked play. A new one arrives at midnight, your time.":
    "për të gjithë, dhe një lojë e renditur. I riu vjen në mesnatë, sipas orës tënde.",
  "— 600 on the first guess, down to 100 on the sixth. Not found, or given up, scores nothing.":
    "— 600 në përpjekjen e parë, deri në 100 në të gjashtën. Pa e gjetur, ose duke u dorëzuar, nuk fiton asgjë.",
  "{price}: {verdict}": "{price}: {verdict}",
  "Play today's product": "Luaj produktin e sotëm",
  "Fetching today's product…": "Po merret produkti i sotëm…",
  "You've played today's product": "E ke luajtur produktin e sotëm",
  Guess: "Provo",
  "Your guess, in dollars": "Përpjekja jote, në dollarë",
  "Type a price, like 4.99.": "Shkruaj një çmim, si 4.99.",
  "Within 5% wins. Amber means within 25%.": "Brenda 5% fiton. Portokallia do të thotë brenda 25%.",
  "{n} left.": "Mbeten {n}.",
  Near: "Afër",
  higher: "më lart",
  lower: "më poshtë",
  "within 5%": "brenda 5%",
  "within 25%": "brenda 25%",
  "Within 5% in {n} of {max}": "Brenda 5% në {n} nga {max}",
  "The price was": "Çmimi ishte",
  Price: "Çmimi",
  "Give up today's product?": "Dorëzohesh për produktin e sotëm?",
  "The price is shown and the run scores nothing. There is one play a day.":
    "Çmimi tregohet dhe loja nuk merr pikë. Ka një lojë në ditë.",

  // ── Only Once ────────────────────────────────────────────────────────────────
  "Only Once": "Vetëm Një Herë",
  "Seven questions. Never the same answer twice.":
    "Shtatë pyetje. Asnjëherë e njëjta përgjigje dy herë.",
  "Seven questions a day about one kind of thing — countries, US states or chemical elements. The same answers fit question after question, but each one can only be used once: spend the famous one early and you might need it later.":
    "Shtatë pyetje në ditë për një lloj gjëje — shtete, shtete të SHBA-së ose elemente kimike. E njëjta përgjigje vlen për pyetje pas pyetjeje, por secila përdoret vetëm një herë: harxhoje të njohurën herët dhe mund të të duhet më vonë.",
  "Type an answer and pick it from the list. A wrong answer, or one you have already used, is turned down and you can try again — only the clock ends your day, 25 seconds a question. Each question answered is worth 100, and all seven make 1,000. One ranked play a day; new questions at midnight, your time.":
    "Shkruaj një përgjigje dhe zgjidhe nga lista. Një përgjigje e gabuar, ose e përdorur, refuzohet dhe provon sërish — vetëm ora ta mbyll ditën, 25 sekonda për pyetje. Çdo pyetje e përgjigjur vlen 100, dhe të shtatat bëjnë 1,000. Një lojë e renditur në ditë; pyetje të reja në mesnatë, sipas orës tënde.",
  "Never the same answer twice": "Asnjëherë e njëjta përgjigje dy herë",
  "Seven questions about one kind of thing. Every answer can be used once.":
    "Shtatë pyetje për një lloj gjëje. Çdo përgjigje përdoret një herë.",
  "Answer seven questions": "Përgjigju shtatë pyetjeve",
  "about countries, US states or chemical elements. Start typing and pick from the list; you get 25 seconds each, after two to read.":
    "për shtete, shtete të SHBA-së ose elemente kimike. Fillo të shkruash dhe zgjidh nga lista; ke 25 sekonda për secilën, pas dy për ta lexuar.",
  "Each answer once.": "Çdo përgjigje një herë.",
  "The first questions have plenty of right answers; the last have only a few, and the famous one you gave earlier is often among them.":
    "Pyetjet e para kanë shumë përgjigje të sakta; të fundit vetëm pak, dhe e njohura që dhe më herët shpesh është mes tyre.",
  "Wrong costs nothing": "Gabimi nuk kushton",
  "— a wrong or used answer is turned down and you try again. Only the clock ends your day.":
    "— një përgjigje e gabuar ose e përdorur refuzohet dhe provon sërish. Vetëm ora ta mbyll ditën.",
  "100 a question,": "100 për pyetje,",
  "and 1,000 for all seven. A new set arrives at midnight, your time.":
    "dhe 1,000 për të shtatat. Grupi i ri vjen në mesnatë, sipas orës tënde.",
  "Play today's seven": "Luaj të shtatat e sotme",
  "Fetching today's questions…": "Po merren pyetjet e sotme…",
  "You've played today's seven": "I ke luajtur të shtatat e sotme",
  "Question {n} of {max}": "Pyetja {n} nga {max}",
  Read: "Lexo",
  "Type {noun}…": "Shkruaj {noun}…",
  "a country": "një shtet",
  "a US state": "një shtet të SHBA-së",
  "an element": "një element",
  "You've already used {name}.": "E ke përdorur tashmë {name}.",
  "{name} doesn't fit. Try another.": "{name} nuk përshtatet. Provo një tjetër.",
  "Used answers": "Përgjigjet e përdorura",
  Progress: "Përparimi",
  "All seven — you reached the top!": "Të shtatat — arrite majën!",
  "{n} of {max} answered": "{n} nga {max} të përgjigjura",
  Answered: "Të përgjigjura",
  Countries: "Shtete",
  "Could have been: {names}": "Mund të ishte: {names}",

  // ── Tee Time ─────────────────────────────────────────────────────────────────
  "Tee Time": "Ora e Golfit",
  "A new nine holes every day.": "Nëntë vrima të reja çdo ditë.",
  "A daily nine-hole golf course, built from the date and the same for everyone: fairways that bend, bunkers round the greens, water now and then and a wind on every hole. Pick a club, set your line, and stop the swing meter.":
    "Një fushë golfi me nëntë vrima në ditë, e ndërtuar nga data dhe e njëjta për të gjithë: korsi që kthehen, gropa rëre rreth fushave të gjelbra, ujë herë pas here dhe erë në çdo vrimë. Zgjidh një shkop, cakto drejtimin dhe ndal matësin e goditjes.",
  "Tap the course to aim, then tap Swing and tap again to stop the power meter. Reach the green and the putts are automatic: inside the inner ring one putt, the outer ring two, anywhere else three. Water and out of bounds cost a stroke. Every hole scores (par + 3 − strokes) × 100, so a par is 300 and a birdie 400. One ranked round a day; a new course at midnight, your time.":
    "Prek fushën për të shënjuar, pastaj prek Godit dhe prek sërish për të ndalur matësin e fuqisë. Arri në të gjelbrën dhe goditjet e fundit bëhen vetë: brenda unazës së brendshme një, në unazën e jashtme dy, kudo tjetër tri. Uji dhe dalja jashtë kushtojnë një goditje. Çdo vrimë jep (par + 3 − goditje) × 100, ndaj par është 300 dhe birdie 400. Një raund i renditur në ditë; fushë e re në mesnatë, sipas orës tënde.",
  "Today's nine": "Nëntë vrimat e sotme",
  "A new nine-hole course every day. Every shot is your timing.":
    "Një fushë e re me nëntë vrima çdo ditë. Çdo goditje varet nga koha jote.",
  Aim: "Shënjo",
  "by tapping the course where you want the ball to go. Mind the wind: it pushes every shot.":
    "duke prekur fushën ku do të shkojë topi. Kujdes erën: shtyn çdo goditje.",
  Swing: "Godit",
  "— tap Swing, then tap again to stop the power meter. Pick a club with the arrows; the suggested one reaches the pin at full power.":
    "— prek Godit, pastaj prek sërish për të ndalur matësin e fuqisë. Zgjidh shkopin me shigjeta; i sugjeruari e arrin flamurin me fuqi të plotë.",
  "Find the rings.": "Gjej unazat.",
  "On the green the putts are automatic: inside the inner ring one, the outer ring two, anywhere else three. Water and out of bounds cost a stroke.":
    "Në të gjelbër goditjet e fundit bëhen vetë: brenda unazës së brendshme një, në të jashtmen dy, kudo tjetër tri. Uji dhe dalja jashtë kushtojnë një goditje.",
  "Par is 300": "Par është 300",
  "on every hole, a birdie 400, an eagle 500. One ranked round a day; a new course arrives at midnight, your time.":
    "në çdo vrimë, birdie 400, eagle 500. Një raund i renditur në ditë; fusha e re vjen në mesnatë, sipas orës tënde.",
  "Albatross!": "Albatros!",
  "Eagle!": "Shqiponjë!",
  "Birdie!": "Zog!",
  Par: "Par",
  Bogey: "Bogi",
  "Double bogey": "Bogi i dyfishtë",
  "{n} over par": "{n} mbi par",
  "Hole {n}, par {par}": "Vrima {n}, par {par}",
  "Hole {n}, par {par}: {strokes}": "Vrima {n}, par {par}: {strokes}",
  "P{par}": "P{par}",
  "{n} yds/100": "{n} jardë/100",
  "A par {par}, {yards} yards: the ball is {left} yards from the pin.":
    "Vrimë me par {par}, {yards} jardë: topi është {left} jardë larg flamurit.",
  "Tee off": "Fillo raundin",
  "End today's round here?": "Ta mbyllësh raundin e sotëm këtu?",
  "Finished holes keep their points; the rest score nothing. There is one ranked round a day.":
    "Vrimat e mbaruara i mbajnë pikët; të tjerat nuk japin asgjë. Ka një raund të renditur në ditë.",
  "End today's seven here?": "T'i mbyllësh të shtatat e sotme këtu?",
  "Questions answered keep their points; the rest score nothing. There is one ranked play a day.":
    "Pyetjet e përgjigjura i mbajnë pikët; të tjerat nuk japin asgjë. Ka një lojë të renditur në ditë.",
  "Building today's course…": "Po ndërtohet fusha e sotme…",
  "You've played today's course": "E ke luajtur fushën e sotme",
  "Hole {n} · Par {par} · {yards} yds": "Vrima {n} · Par {par} · {yards} jardë",
  "Stop!": "Ndal!",
  "Next hole": "Vrima tjetër",
  "End round": "Mbyll raundin",
  "Longer club": "Shkop më i gjatë",
  "Shorter club": "Shkop më i shkurtër",
  Power: "Fuqia",
  Calm: "Qetë",
  Scorecard: "Karta e pikëve",
  Strokes: "Goditje",
  "Course par": "Par i fushës",
  "{carry} yds full · {pin} yds to pin · stroke {n}":
    "{carry} jardë plot · {pin} jardë te flamuri · goditja {n}",
  "Penalty stroke: water or out of bounds.": "Goditje ndëshkimi: ujë ose jashtë fushe.",
  "Tap the course to aim. Arrow keys and Space work too.":
    "Prek fushën për të shënjuar. Punojnë edhe shigjetat dhe Space.",
  "Verifying your round with the server…": "Po verifikohet raundi me serverin…",
  "Round complete: {strokes} strokes ({toPar})": "Raundi mbaroi: {strokes} goditje ({toPar})",
  "{n} of {max} holes played": "{n} nga {max} vrima të luajtura",
  "Hole in one!": "Me një goditje!",
  "Picked up at {n}": "U ngrit te {n}",
  "{strokes} strokes, {putts} {puttWord}": "{strokes} goditje, {putts} {puttWord}",
  putt: "goditje në të gjelbër",
  putts: "goditje në të gjelbër",
  Driver: "Drajver",
  Wedge: "Uexh",
  "Sand wedge": "Uexh rëre",
  Chip: "Çip",
};
