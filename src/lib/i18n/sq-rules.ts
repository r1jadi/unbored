/**
 * Albanian for every game's rules (`lib/games/rules.ts`). A rule is a bold lead
 * followed by its text, so each pair is written to read as one sentence.
 */
export const sqRules: Record<string, string> = {
  // Headings and summaries
  "Make it ten": "Bëje dhjetë",
  "Drop each tile into a column. Exactly ten clears it.":
    "Lësho çdo pllakë në një kolonë. Saktësisht dhjetë e pastron.",
  "Don't break the chain": "Mos e këput zinxhirin",
  "Watch the sequence, then tap it back.": "Shiko radhën, pastaj përsërite me prekje.",
  "See it once": "Shihe një herë",
  "A pattern flashes. Rebuild it from memory.": "Një model ndriçon. Rindërtoje nga kujtesa.",
  "One move away": "Një lëvizje larg",
  "Merge the shades": "Bashko nuancat",
  "Two equal colours become the next shade. Keep the board moving.":
    "Dy ngjyra të njëjta bëhen nuanca e radhës. Mbaje tabelën në lëvizje.",
  "Tap white. Only white.": "Prek të bardhën. Vetëm të bardhën.",
  "Seven seconds. Answer everything.": "Shtatë sekonda. Përgjigju gjithçkaje.",
  "Arithmetic with three answers and one shrinking clock. Keep it alive.":
    "Aritmetikë me tre përgjigje dhe një orë që zvogëlohet. Mbaje gjallë.",
  "One crown each": "Nga një kurorë",
  "Balance every row and column. Beat the clock.": "Baraspesho çdo rresht dhe kolonë. Mund orën.",
  "One path, every cell, the numbers in order. Beat the clock.":
    "Një shteg, çdo kuti, numrat me radhë. Mund orën.",
  "Draw one path": "Vizato një shteg",
  "Slide it home": "Rrëshqite në vend",
  "Eight tiles, one gap. Put them back in order before the clock runs out.":
    "Tetë pllaka, një hapësirë. Renditi para se të mbarojë ora.",
  "Suns and moons": "Diej dhe hëna",
  "One to nine": "Nga një te nëntë",
  "Every row, column and box, once each. Beat the clock.":
    "Çdo rresht, kolonë dhe kuti, nga një herë. Mund orën.",
  "One to six": "Nga një te gjashtë",
  "A small Sudoku on a 6×6 grid. Beat the clock.": "Një Sudoku i vogël në rrjetë 6×6. Mund orën.",
  "Today's crossword": "Fjalëkryqi i sotëm",
  "One puzzle a day, the same for everyone. Solve it fast.":
    "Një enigmë në ditë, e njëjta për të gjithë. Zgjidhe shpejt.",
  "Fill a line, watch it burst": "Mbush një vijë, shiko si shpërthen",
  "Drop the pieces onto the grid. A full row or column bursts.":
    "Lësho copat në rrjetë. Një rresht ose kolonë e plotë shpërthen.",
  "Ride the updraft": "Ngjitu me rrymën",
  "Tap to lift the glider. Thread the gaps between the columns.":
    "Prek për të ngritur avionin pa motor. Kalo nëpër hapësirat mes kolonave.",
  "Pour until it's sorted": "Derdh derisa të renditet",
  "Pour the colours between the tubes until each tube holds just one.":
    "Derdh ngjyrat mes epruvetave derisa secila të mbajë vetëm një.",
  "One tap, one chain": "Një prekje, një zinxhir",
  "Spend sparks to charge the grid. Set off chains that pay the sparks back.":
    "Shpenzo shkëndija për të ngarkuar rrjetën. Nis zinxhirë që t'i kthejnë shkëndijat.",
  "to spend a spark and add one charge. At four charge a cell pops and fires a bolt each way.":
    "për të shpenzuar një shkëndijë dhe për të shtuar një ngarkesë. Me katër ngarkesa kutia shpërthen dhe lëshon një rrufe në çdo drejtim.",
  "A bolt": "Një rrufe",
  "reaches up to three cells and adds one charge to the first charged cell it meets, which can pop that one too. Each wave of a chain is worth more than the last.":
    "arrin deri në tri kuti dhe i shton një ngarkesë kutisë së parë të ngarkuar që takon, e cila mund të shpërthejë edhe ajo. Çdo valë e zinxhirit vlen më shumë se e mëparshmja.",
  "Long chains pay.": "Zinxhirët e gjatë paguajnë.",
  "Four pops from one tap gives back a spark, seven gives two, eleven gives three. Leave four charged cells or fewer to clear the board for three more.":
    "Katër shpërthime nga një prekje kthejnë një shkëndijë, shtatë kthejnë dy, njëmbëdhjetë kthejnë tri. Lër katër kuti të ngarkuara ose më pak për ta pastruar tabelën dhe për të marrë edhe tri.",
  "It gets harder.": "Bëhet më e vështirë.",
  "Every second board asks for longer chains. From board three, surge cells fire diagonally too; from board five, a shielded cell's first hit only breaks its shield. The run ends when the sparks run out.":
    "Çdo tabelë e dytë kërkon zinxhirë më të gjatë. Nga tabela e tretë, kutitë e fuqishme lëshojnë rrufe edhe diagonalisht; nga tabela e pestë, goditja e parë te një kuti e mbrojtur vetëm ia thyen mburojën. Loja mbaron kur mbarojnë shkëndijat.",
  "Change your mind": "Ndërro mendje",
  "whenever you like: Undo takes back any tap and Clear board starts the board again, and neither costs a point. Crowns that break the rules turn red.":
    "kur të duash: Zhbëj e kthen çdo prekje dhe Pastro tabelën e nis tabelën nga e para, dhe asnjëra nuk kushton pikë. Kurorat që shkelin rregullat bëhen të kuqe.",
  "No clock": "Pa orë",
  "to lose to. Every board has one solution and is worth 100 points a row, and beating its par time earns a speed bonus when the run ends, up to double. The boards grow as you go, and you end the run when you like.":
    "që të humbësh prej saj. Çdo tabelë ka një zgjidhje dhe vlen 100 pikë për rresht, dhe nëse e mund kohën normale të saj fiton një bonus shpejtësie kur mbaron loja, deri në dyfish. Tabelat rriten ndërsa luan, dhe ti e mbyll lojën kur të duash.",
  "Every row, column and box, once each. Be quick for a bonus.":
    "Çdo rresht, kolonë dhe kuti, nga një herë. Ji i shpejtë për një bonus.",
  "A small Sudoku on a 6×6 grid. Be quick for a bonus.":
    "Një Sudoku i vogël në rrjetë 6×6. Ji i shpejtë për një bonus.",
  "to lose to. Boards start gentle and get harder, and every solved board scores 900 points. Beating a board's par time earns a speed bonus when the run ends, up to double. You end the run when you like.":
    "që të humbësh prej saj. Tabelat nisin lehtë dhe vështirësohen, dhe çdo tabelë e zgjidhur jep 900 pikë. Nëse e mund kohën normale të tabelës, fiton një bonus shpejtësie kur mbaron loja, deri në dyfish. Ti e mbyll lojën kur të duash.",
  "to lose to. Boards start gentle and get harder, and every solved board scores 600 points. Beating a board's par time earns a speed bonus when the run ends, up to double. You end the run when you like.":
    "që të humbësh prej saj. Tabelat nisin lehtë dhe vështirësohen, dhe çdo tabelë e zgjidhur jep 600 pikë. Nëse e mund kohën normale të tabelës, fiton një bonus shpejtësie kur mbaron loja, deri në dyfish. Ti e mbyll lojën kur të duash.",
  "Clear the way": "Hape rrugën",
  "Send every arrow off the board. Mind what stands in its lane.":
    "Nxirr çdo shigjetë nga tabela. Kujdes çfarë qëndron në rrugën e saj.",
  "Every block escapes": "Çdo bllok del",
  "Slide each block out through the gate of its own colour.":
    "Rrëshqit çdo bllok jashtë nga porta e ngjyrës së vet.",

  // Leads
  "Place the tile": "Vendose pllakën",
  "Exactly ten": "Saktësisht dhjetë",
  "No final tile.": "Nuk ka pllakë të fundit.",
  Watch: "Shiko",
  "Every round": "Çdo raund",
  "A wrong tap": "Një prekje e gabuar",
  "One wrong or repeated cell": "Një kuti e gabuar ose e përsëritur",
  "No final pattern.": "Nuk ka model të fundit.",
  "A move": "Një lëvizje",
  "Your move": "Lëvizja jote",
  Slide: "Rrëshqit",
  Merge: "Bashkimi",
  "No final slide.": "Nuk ka rrëshqitje të fundit.",
  Tap: "Prek",
  "Never touch a black tile.": "Mos prek kurrë pllakë të zezë.",
  "No final row.": "Nuk ka rresht të fundit.",
  "Seven seconds": "Shtatë sekonda",
  "A right answer": "Një përgjigje e saktë",
  "A wrong answer": "Një përgjigje e gabuar",
  "One ranked attempt": "Një përpjekje në renditje",
  "The goal": "Qëllimi",
  "Tap a cell": "Prek një kuti",
  "A wrong crown": "Një kurorë e gabuar",
  "Drag or tap": "Tërhiq ose prek",
  "The clock": "Ora",
  "Tap a tile": "Prek një pllakë",
  "Fill the grid": "Mbush rrjetën",
  Signs: "Shenjat",
  "Pick a cell": "Zgjidh një kuti",
  "Notes and Undo": "Shënimet dhe Zhbëj",
  "Stuck?": "Ngece?",
  "A mini every weekday": "Një mini çdo ditë pune",
  "Pick a square": "Zgjidh një katror",
  "Faster scores more.": "Më shpejt jep më shumë pikë.",
  "Drag a piece": "Tërhiq një copë",
  "Fill a row or column": "Mbush një rresht ose kolonë",
  "Keep the combo.": "Mbaje kombinimin.",
  "No final tray.": "Nuk ka grup copash të fundit.",
  "Thread the gaps.": "Kalo nëpër hapësira.",
  "Don't touch": "Mos prek",
  "No last column.": "Nuk ka kolonë të fundit.",
  "Tap a tube, then another,": "Prek një epruvetë, pastaj një tjetër,",
  "Sort every tube": "Rendit çdo epruvetë",
  "A blocked tile jams": "Një pllakë e bllokuar ngec",
  Turnstiles: "Rrotullueset",
  "No last board.": "Nuk ka tabelë të fundit.",
  "Drag a block": "Tërhiq një bllok",
  Gates: "Portat",
  "Blocks get in each other's way,": "Blloqet i zënë rrugën njëri-tjetrit,",
  "Don't let a white tile pass.": "Mos lër të kalojë asnjë pllakë e bardhë.",

  // Texts
  "shown above the board in one of the four columns: tap a column, or press 1 to 4.":
    "që shfaqet mbi tabelë në një nga katër kolonat: prek një kolonë, ose shtyp 1 deri në 4.",
  "clears the column and scores. A column that goes past ten ends the run.":
    "e pastron kolonën dhe jep pikë. Një kolonë që kalon dhjetën e mbyll lojën.",
  "Heavier tiles turn up more often the longer you play, so clears get rarer and the board gets tighter.":
    "Sa më gjatë të luash, aq më shpesh vijnë pllaka më të rënda, ndaj pastrimet rrallohen dhe tabela ngushtohet.",
  "the pads flash in order, then tap them back in the same order. Number keys 1 to 4 work too.":
    "butonat ndriçojnë me radhë, pastaj preki në të njëjtën radhë. Funksionojnë edhe tastet 1 deri në 4.",
  "adds one more step, and the beat gets a little quicker.":
    "shton edhe një hap, dhe ritmi shpejtohet pak.",
  "breaks the chain and ends the run. Every correct tap scores 10 points, and there is no final round.":
    "e këput zinxhirin dhe e mbyll lojën. Çdo prekje e saktë jep 10 pikë, dhe nuk ka raund të fundit.",
  "the lit cells, then tap them back in any order.":
    "kutitë e ndezura, pastaj preki në çfarëdo radhe.",
  "ends the run. A rebuilt pattern is 100 points.":
    "e mbyll lojën. Një model i rindërtuar vlen 100 pikë.",
  "Every round adds a cell, the flash gets shorter, and the board grows when the pattern outgrows it.":
    "Çdo raund shton një kuti, ndriçimi shkurtohet, dhe tabela rritet kur modeli nuk nxë më.",
  "flips one cell and the cells above, below, left and right of it that are on the board.":
    "kthen një kuti dhe kutitë sipër, poshtë, majtas dhe djathtas saj që janë në tabelë.",
  "Every board is a checkerboard with exactly one move already made.":
    "Çdo tabelë është një fushë shahu me saktësisht një lëvizje të bërë tashmë.",
  "is the one that puts the checkerboard back. Tap that cell.":
    "është ajo që e rikthen fushën e shahut. Prek atë kuti.",
  "ends the run. The board grows as you go; every restored board is 100 points, and there is no final board.":
    "e mbyll lojën. Tabela rritet ndërsa vazhdon; çdo tabelë e rikthyer vlen 100 pikë, dhe nuk ka tabelë të fundit.",
  "the whole board with the arrow keys, WASD, a swipe, or the buttons below the board.":
    "gjithë tabelën me shigjetat, WASD, një rrëshqitje gishti ose butonat poshtë tabelës.",
  "equal neighbours — two 2s make a 4, two 4s make an 8. Each tile merges once per slide.":
    "fqinjët e njëjtë — dy 2 bëjnë 4, dy 4 bëjnë 8. Çdo pllakë bashkohet një herë për rrëshqitje.",
  "The run ends only when the board locks — every cell full with no matching neighbours. New tiles arrive with a growing chance of a higher shade, so the space you have to work with keeps shrinking.":
    "Loja mbaron vetëm kur tabela bllokohet — çdo kuti plot dhe pa fqinjë të njëjtë. Pllakat e reja vijnë me mundësi në rritje për nuancë më të lartë, ndaj hapësira për të punuar vjen duke u ngushtuar.",
  "the white tiles in the row at the line. Number keys 1–3 or A, S and D work too.":
    "pllakat e bardha në rreshtin te vija. Funksionojnë edhe tastet 1–3 ose A, S dhe D.",
  "One black tap ends the run on the spot.": "Një prekje e zezë e mbyll lojën menjëherë.",
  "A row that leaves the line with a white tile still on it ends the run too.":
    "Edhe një rresht që largohet nga vija me një pllakë të bardhë ende në të e mbyll lojën.",
  "Rows rise to the line. Clear every white tile before the row passes.":
    "Rreshtat ngjiten deri te vija. Pastro çdo pllakë të bardhë para se rreshti të kalojë.",
  "Every row tightens the beat, and the longer you last the more of each row turns black — and the darker it gets, until you can't see what's coming.":
    "Çdo rresht e shpejton ritmin, dhe sa më gjatë të qëndrosh, aq më shumë nga çdo rresht nxihet — dhe errësohet derisa nuk sheh dot çfarë vjen.",
  "on the clock. Answer as many challenges as you can before it empties.":
    "në orë. Përgjigju sa më shumë sfidave para se të mbarojë.",
  "adds 1.5 seconds and scores 100 points.": "shton 1.5 sekonda dhe jep 100 pikë.",
  "costs 2 seconds. Three of them can empty a fresh clock.":
    "kushton 2 sekonda. Tri të tilla mund ta zbrazin një orë të re.",
  "per day. Everyone on your date plays the same deck; the next one arrives at midnight, your time.":
    "në ditë. Të gjithë në datën tënde luajnë të njëjtën pako; tjetra vjen në mesnatë, sipas orës sate.",
  "is exactly one crown in every row, every column and every colour region. Two crowns can never touch, not even diagonally.":
    "është saktësisht një kurorë në çdo rresht, çdo kolonë dhe çdo zonë ngjyre. Dy kurora nuk mund të prekin kurrë njëra-tjetrën, as diagonalisht.",
  "Every board is split into coloured regions, one for each row.":
    "Çdo tabelë është e ndarë në zona me ngjyra, një për çdo rresht.",
  "once for an X — a note that no crown goes there — twice for a crown, and a third time to clear it.":
    "një herë për X — shënim që aty nuk shkon kurorë — dy herë për kurorë, dhe herën e tretë për ta pastruar.",
  "is a mistake, and the third one ends the run. Every board has one solution and is worth 100 points a row; the boards grow as you go, and you can end the run whenever you like.":
    "është gabim, dhe i treti e mbyll lojën. Çdo tabelë ka një zgjidhje dhe vlen 100 pikë për rresht; tabelat rriten ndërsa vazhdon, dhe mund ta mbyllësh lojën kur të duash.",
  "from 1 through every number in order, ending on the highest. It must visit every cell exactly once, moving up, down, left or right, and never through a wall.":
    "nga 1 nëpër çdo numër me radhë, duke mbaruar te më i madhi. Duhet të kalojë në çdo kuti saktësisht një herë, lart, poshtë, majtas ose djathtas, dhe kurrë përmes një muri.",
  "to extend the path. Go back over it to undo.":
    "për ta zgjatur shtegun. Kthehu mbi të për ta zhbërë.",
  "starts at 75 seconds, and every solved board adds about five seconds a row: a little more early on, less as the run goes. Each board is worth 100 points a row, the boards grow as you go, and the run ends when the clock does.":
    "nis me 75 sekonda, dhe çdo tabelë e zgjidhur shton rreth pesë sekonda për rresht: pak më shumë në fillim, më pak ndërsa loja vazhdon. Çdo tabelë vlen 100 pikë për rresht, tabelat rriten ndërsa vazhdon, dhe loja mbaron kur mbaron ora.",
  "next to the gap to slide it in, or use the arrow keys.":
    "pranë hapësirës për ta rrëshqitur aty, ose përdor shigjetat.",
  "is 1 to 8 in reading order, with the gap in the bottom-right corner. Every board can be solved; each one is scrambled a little more than the last.":
    "është 1 deri në 8 sipas radhës së leximit, me hapësirën në këndin e poshtëm djathtas. Çdo tabelë mund të zgjidhet; secila është pak më e përzier se e mëparshmja.",
  "starts at 75 seconds, and every solved board adds 100 points and time: 18 seconds for the first, less with each board after, down to 7.5. The run ends when the clock does.":
    "nis me 75 sekonda, dhe çdo tabelë e zgjidhur shton 100 pikë dhe kohë: 18 sekonda për të parën, më pak për çdo tabelë pas saj, deri në 7.5. Loja mbaron kur mbaron ora.",
  "with suns and moons: every row and every column holds three of each, and no three alike sit next to each other across or down.":
    "me diej dhe hëna: çdo rresht dhe çdo kolonë mban nga tre, dhe asnjë treshe e njëjtë nuk qëndron njëra pas tjetrës horizontalisht ose vertikalisht.",
  "between two cells say how they relate: = means they match, × means they differ.":
    "mes dy kutive tregojnë si lidhen: = do të thotë se përputhen, × se ndryshojnë.",
  "for a sun, again for a moon, and once more to clear it. Cells that start filled stay as they are; clashes are marked in red.":
    "për diell, sërish për hënë, dhe edhe një herë për ta pastruar. Kutitë që nisin të mbushura mbeten siç janë; përplasjet shënohen me të kuqe.",
  "starts at 2:20, and every solved board adds 600 points and time: 54 seconds for the first, less with each board after, down to 22.5. Each board starts with fewer cells filled, and the run ends when the clock does.":
    "nis me 2:20, dhe çdo tabelë e zgjidhur shton 600 pikë dhe kohë: 54 sekonda për të parën, më pak për çdo tabelë pas saj, deri në 22.5. Çdo tabelë nis me më pak kuti të mbushura, dhe loja mbaron kur mbaron ora.",
  "so that every row, every column and every 3×3 box holds the digits 1 to 9 once each. Every board has exactly one solution.":
    "që çdo rresht, çdo kolonë dhe çdo kuti 3×3 të mbajë shifrat 1 deri në 9 nga një herë. Çdo tabelë ka saktësisht një zgjidhje.",
  "and tap a number to place it, or Erase to clear it. You can also type 1 to 9, and move with the arrow keys. Cells that start filled stay as they are; a digit that repeats is marked in red.":
    "dhe prek një numër për ta vendosur, ose Fshi për ta pastruar. Mund të shkruash edhe 1 deri në 9 dhe të lëvizësh me shigjetat. Kutitë që nisin të mbushura mbeten siç janë; një shifër që përsëritet shënohet me të kuqe.",
  "Turn on Notes (or press N) to jot small candidate digits in a cell; placing a digit tidies them away. Undo (Ctrl+Z) steps back.":
    "Aktivizo Shënimet (ose shtyp N) për të shkruar shifra të mundshme të vogla në një kuti; vendosja e një shifre i heq. Zhbëj (Ctrl+Z) kthen një hap.",
  "starts at 6:40. Boards start gentle and get harder, and every solved board scores 900 points and adds time for the next one: generous early on, tighter as the run goes. The run ends when the clock does.":
    "nis me 6:40. Tabelat nisin të lehta dhe vështirësohen, dhe çdo tabelë e zgjidhur jep 900 pikë dhe shton kohë për tjetrën: bujarisht në fillim, më ngushtë ndërsa loja vazhdon. Loja mbaron kur mbaron ora.",
  "so that every row, every column and every 2×3 box (two rows tall, three wide) holds the digits 1 to 6 once each. Every board has exactly one solution.":
    "që çdo rresht, çdo kolonë dhe çdo kuti 2×3 (dy rreshta e lartë, tre e gjerë) të mbajë shifrat 1 deri në 6 nga një herë. Çdo tabelë ka saktësisht një zgjidhje.",
  "and tap a number to place it, or Erase to clear it. You can also type 1 to 6, and move with the arrow keys. Cells that start filled stay as they are; a digit that repeats is marked in red.":
    "dhe prek një numër për ta vendosur, ose Fshi për ta pastruar. Mund të shkruash edhe 1 deri në 6 dhe të lëvizësh me shigjetat. Kutitë që nisin të mbushura mbeten siç janë; një shifër që përsëritet shënohet me të kuqe.",
  "starts at 2:00. Boards start gentle and get harder, and every solved board scores 600 points and adds time for the next one: generous early on, tighter as the run goes. The run ends when the clock does.":
    "nis me 2:00. Tabelat nisin të lehta dhe vështirësohen, dhe çdo tabelë e zgjidhur jep 600 pikë dhe shton kohë për tjetrën: bujarisht në fillim, më ngushtë ndërsa loja vazhdon. Loja mbaron kur mbaron ora.",
  "— a 5×5 grid — and a bigger 7×7 midi on Saturday and Sunday. Every clue is original.":
    "— një rrjetë 5×5 — dhe një midi më i madh 7×7 të shtunën dhe të dielën. Çdo përkufizim është origjinal.",
  "and type. Pick it again, or tap the clue, to switch between across and down; the arrows step through the clues.":
    "dhe shkruaj. Zgjidhe sërish, ose prek përkufizimin, për të kaluar mes horizontales dhe vertikales; shigjetat kalojnë nëpër përkufizime.",
  "A mini is worth 10,000 if you solve it within 30 seconds, a midi 20,000 within a minute; after that it slips 40 points a second.":
    "Një mini vlen 10 000 nëse e zgjidh brenda 30 sekondave, një midi 20 000 brenda një minute; pas kësaj bie 40 pikë në sekondë.",
  "Check the grid (−50) to see which letters are wrong, or reveal a letter (−100 each). One ranked solve a day; a new crossword arrives at midnight, your time.":
    "Kontrollo rrjetën (−50) për të parë cilat shkronja janë gabim, ose zbulo një shkronjë (−100 secila). Një zgjidhje në renditje në ditë; një fjalëkryq i ri vjen në mesnatë, sipas orës sate.",
  "from the tray onto the grid — or tap a piece, then a square for its top-left corner. Pieces don't rotate.":
    "nga grupi i copave në rrjetë — ose prek një copë, pastaj një katror për këndin e saj të sipërm majtas. Copat nuk rrotullohen.",
  "and it bursts. Every square placed is 10 points; bursting L lines at once scores 100 × L², times your combo.":
    "dhe ai shpërthen. Çdo katror i vendosur vlen 10 pikë; shpërthimi i L vijave njëherësh jep 100 × L², shumëzuar me kombinimin.",
  "Each burst raises it by one; three placements in a row without a burst reset it. Empty the whole board for 300 more.":
    "Çdo shpërthim e rrit me një; tri vendosje rresht pa shpërthim e rinisin. Zbraz gjithë tabelën për 300 të tjera.",
  "Place all three pieces and three more arrive, bigger ones more often as you go. The run ends when nothing in your tray fits.":
    "Vendos të tria copat dhe vijnë edhe tri, më shpesh më të mëdha ndërsa vazhdon. Loja mbaron kur asgjë nga copat nuk përshtatet.",
  "— or click, or press Space. Each flap lifts the glider; between flaps it falls.":
    "— ose kliko, ose shtyp Space. Çdo përplasje krahësh e ngre avionin; mes përplasjeve ai bie.",
  "Every column you get through is 10 points.": "Çdo kolonë që kalon vlen 10 pikë.",
  "a column or the ground: either one ends the run. The top of the sky is safe to brush.":
    "një kolonë ose tokën: secila e mbyll lojën. Maja e qiellit mund të preket pa rrezik.",
  "The field speeds up and the gaps narrow as you go, until you slip or end the run.":
    "Fusha shpejtohet dhe hapësirat ngushtohen ndërsa vazhdon, derisa të gabosh ose ta mbyllësh lojën.",
  "to pour. It only lands on an empty tube or on the same colour, and the whole top layer of that colour goes — as much as fits.":
    "për të derdhur. Derdhet vetëm në një epruvetë bosh ose mbi të njëjtën ngjyrë, dhe shkon gjithë shtresa e sipërme e asaj ngjyre — aq sa nxë.",
  "into a single colour to solve the board: 10 points per colour, and about 5 more seconds on the clock per colour: a little more early on, less as the run goes.":
    "në një ngjyrë të vetme për ta zgjidhur tabelën: 10 pikë për ngjyrë, dhe rreth 5 sekonda më shumë në orë për ngjyrë: pak më shumë në fillim, më pak ndërsa loja vazhdon.",
  "Undo a pour, restart the board, or add one empty tube to it for 15 seconds of clock.":
    "Zhbëj një derdhje, rinis tabelën, ose shto një epruvetë bosh për 15 sekonda nga ora.",
  "Boards start with three colours and gain one every second board, up to nine. The run ends when the clock does.":
    "Tabelat nisin me tre ngjyra dhe fitojnë një çdo dy tabela, deri në nëntë. Loja mbaron kur mbaron ora.",
  "and it flies off the board the way its arrow points: 10 points. It only goes if nothing stands between it and the edge.":
    "dhe ajo fluturon jashtë tabelës nga ana ku tregon shigjeta: 10 pikë. Ikën vetëm nëse asgjë nuk qëndron mes saj dhe skajit.",
  "and stays where it is. Three jams end the run.":
    "dhe mbetet ku është. Tre bllokime e mbyllin lojën.",
  "carry a ⟳ badge: every tile that escapes turns each of them a quarter turn clockwise. Wait for one to face a clear lane.":
    "kanë një shenjë ⟳: çdo pllakë që del i rrotullon një çerek rrotullimi në drejtim të orës. Prit që njëra të kthehet nga një rrugë e lirë.",
  "Clear a board for 50 more, and the next is bigger and busier. A board where no tile can leave is lost for a jam.":
    "Pastro një tabelë për 50 të tjera, dhe tjetra është më e madhe e më e mbushur. Një tabelë ku asnjë pllakë nuk mund të dalë humbet si bllokim.",
  "up, down, left or right, and it slides until a wall, another block or the edge stops it. On a keyboard, focus a block and use the arrow keys.":
    "lart, poshtë, majtas ose djathtas, dhe rrëshqet derisa ta ndalë një mur, një bllok tjetër ose skaji. Në tastierë, zgjidh një bllok dhe përdor shigjetat.",
  "sit in the board's frame. A block that reaches a gate of its own colour, lined up so the gate covers its whole width, slips out.":
    "janë në kornizën e tabelës. Një bllok që arrin një portë të ngjyrës së vet, i drejtuar që porta të mbulojë gjithë gjerësinë e tij, del jashtë.",
  "so the order matters: move one aside to open a path for another. Undo or restart the board any time.":
    "ndaj radha ka rëndësi: lëviz njërin mënjanë për t'i hapur rrugë një tjetri. Zhbëj ose rinis tabelën kur të duash.",
  "starts at 75 seconds. Clear a board for 10 points per block and time for the next one; boards grow trickier, and the time they add tightens as the run goes. The run ends when the clock does.":
    "nis me 75 sekonda. Pastro një tabelë për 10 pikë për bllok dhe kohë për tjetrën; tabelat vështirësohen, dhe koha që shtojnë ngushtohet ndërsa loja vazhdon. Loja mbaron kur mbaron ora.",
};
