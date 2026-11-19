/**
 * Albanian for Dead Reckoning: its catalogue text, rules, screens and round
 * prompts. The names in the lists (mountains, rivers, people…) and the estimate
 * questions stay English for now: the autocomplete matches the English names.
 */
export const sqDeadReckoning: Record<string, string> = {
  // ── The catalogue ────────────────────────────────────────────────────────────
  "Dead Reckoning": "Lundrim me Vlerësim",
  "Seven numbers. Get as close as you can.": "Shtatë numra. Afrohu sa më shumë.",
  "Seven fast rounds a day, thirty seconds each. Every round gives you a number: name a mountain, a river, a building, a famous person or a country whose real value is closest to it, or estimate the answer yourself. The nearer you land, the higher your plane climbs, but it sinks while the clock runs, so be quick as well as close.":
    "Shtatë raunde të shpejta në ditë, tridhjetë sekonda secili. Çdo raund të jep një numër: emërto një mal, një lumë, një ndërtesë, një person të njohur ose një shtet, vlera e vërtetë e të cilit është më afër tij, ose vlerëso vetë përgjigjen. Sa më afër të biesh, aq më lart ngjitet avioni yt, por ai zbret ndërsa ora ecën, ndaj ji i shpejtë dhe i saktë.",
  "Type an answer and pick it from the suggestions, or type your estimate, and submit before the clock runs out. Every answer is rated from Miss to Dialed (within 1%), worth up to 1,000, and the points drain as the clock runs: answer at once for all of them, at the buzzer for 40%. One round a day is golden and counts double. One ranked play a day; seven new rounds arrive at midnight, your time.":
    "Shkruaj një përgjigje dhe zgjidhe nga sugjerimet, ose shkruaj vlerësimin tënd, dhe dërgoje para se të mbarojë koha. Çdo përgjigje vlerësohet nga Humbur deri Në shenjë (brenda 1%), deri në 1,000 pikë, dhe pikët pakësohen ndërsa ora ecën: përgjigju menjëherë për të gjitha, në sekondën e fundit për 40%. Një raund në ditë është i artë dhe vlen dyfish. Një lojë e renditur në ditë; shtatë raunde të reja vijnë në mesnatë, sipas orës tënde.",

  // ── Rules ────────────────────────────────────────────────────────────────────
  "How close can you get?": "Sa afër mund të shkosh?",
  "Seven rounds, thirty seconds each. Land as near the number as you can.":
    "Shtatë raunde, tridhjetë sekonda secili. Bjer sa më afër numrit.",
  "Name it or guess it.": "Emërtoje ose vlerësoje.",
  "Pick something from the suggestions whose real value is closest to the number, or type your own estimate.":
    "Zgjidh nga sugjerimet diçka, vlera e vërtetë e së cilës është më afër numrit, ose shkruaj vlerësimin tënd.",
  "Miss to Dialed.": "Nga Humbur deri Në shenjë.",
  "Within 1% is Dialed, worth 1,000. Then Sharp (3%), Near (7%), Warm (15%) and Rough (30%). Further is a Miss.":
    "Brenda 1% është Në shenjë, vlen 1,000. Pastaj I saktë (3%), Afër (7%), Ngrohtë (15%) dhe Përafërsisht (30%). Më larg është Humbur.",
  "The plane sinks": "Avioni zbret",
  "while the clock runs: answer at once for every point, at the buzzer for 40%. Time out and the round scores nothing.":
    "ndërsa ora ecën: përgjigju menjëherë për çdo pikë, në sekondën e fundit për 40%. Nëse mbaron koha, raundi nuk jep pikë.",
  "One golden round": "Një raund i artë",
  "a day counts double. Seven new rounds arrive at midnight, your time, and there is one ranked play a day.":
    "në ditë vlen dyfish. Shtatë raunde të reja vijnë në mesnatë, sipas orës tënde, dhe ka një lojë të renditur në ditë.",

  // ── Ratings ──────────────────────────────────────────────────────────────────
  Dialed: "Në shenjë",
  Sharp: "I saktë",
  Warm: "Ngrohtë",
  Rough: "Përafërsisht",
  Miss: "Humbur",

  // ── The board ────────────────────────────────────────────────────────────────
  "Fetching today's rounds…": "Po merren raundet e sotme…",
  "Golden round: double points": "Raund i artë: pikë dyfish",
  "Round {n} of {max}": "Raundi {n} nga {max}",
  "Score {score}": "Pikët {score}",
  "Up to +{points} now": "Deri në +{points} tani",
  "Altitude: {percent}%": "Lartësia: {percent}%",
  "Your estimate": "Vlerësimi yt",
  "In {unit}": "Në {unit}",
  "Pick an answer from the suggestions.": "Zgjidh një përgjigje nga sugjerimet.",
  "Type a whole number, like 1,250.": "Shkruaj një numër të plotë, si 1,250.",
  "No answer": "Pa përgjigje",
  "Timed out": "Mbaroi koha",
  "Nearest: {answer}": "Më i afërti: {answer}",
  "Answer: {answer}": "Përgjigjja: {answer}",
  "Rounds answered keep their points. It's practice, so nothing is lost.":
    "Raundet e përgjigjura i mbajnë pikët. Është stërvitje, ndaj nuk humbet asgjë.",
  "Rounds answered keep their points; the rest score nothing. There is one ranked play a day.":
    "Raundet e përgjigjura i mbajnë pikët; të tjerat nuk japin asgjë. Ka një lojë të renditur në ditë.",

  // ── The result ───────────────────────────────────────────────────────────────
  "Dead on. Flying high!": "Në shenjë. Po fluturon lart!",
  "A smooth flight": "Një fluturim i qetë",
  "Some turbulence": "Pak turbulencë",
  "A bumpy landing": "Një ulje me tronditje",

  // ── The rounds ───────────────────────────────────────────────────────────────
  "a mountain": "një mal",
  "a river": "një lumë",
  "a building or structure": "një ndërtesë a strukturë",
  "a famous person": "një person të njohur",
  "a country": "një shtet",
  "Name a mountain whose height is closest to {target} m":
    "Emërto një mal, lartësia e të cilit është më afër {target} m",
  "Name a river whose length is closest to {target} km":
    "Emërto një lumë, gjatësia e të cilit është më afër {target} km",
  "Name a building or structure whose height is closest to {target} m":
    "Emërto një ndërtesë a strukturë, lartësia e së cilës është më afër {target} m",
  "Name a famous person born as close as you can to {target}":
    "Emërto një person të njohur të lindur sa më afër vitit {target}",
  "Name a country whose area is closest to {target} km²":
    "Emërto një shtet, sipërfaqja e të cilit është më afër {target} km²",
  "Name a planet whose diameter is closest to":
    "Emërto një planet, diametri i të cilit është më afër",
};
