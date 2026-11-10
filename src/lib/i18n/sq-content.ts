/**
 * Albanian for text that comes from the database rather than the code: the
 * catalogue's games and categories (applied by `localizeGame` in
 * `lib/games/catalog.ts`) and the stored values admin badges show. Looked up
 * with `translateContent`, so a catalogue entry an admin edits later simply
 * shows as written until this file learns the new text.
 *
 * Game names are translated where Albanian has a natural name for them and kept
 * where they are a name rather than a phrase (Stack 10, Sudoku, Huedini,
 * Gridburst). The daily crossword is Fjalekryqi, which also plays Albanian
 * puzzles (`fjalekryqi@1`).
 */
export const sqContent: Record<string, string> = {
  // Titles, as the catalogue names them, and as a slug spells them before it loads
  "Daily Crossword": "Fjalekryqi",
  Crossword: "Fjalekryqi",
  Crowns: "Kurorat",
  Trail: "Gjurma",
  "Sun & Moon": "Dielli & Hëna",
  "Sun and Moon": "Dielli & Hëna",
  "One Move": "Një Lëvizje",
  "Don't Break the Chain": "Mos e Këput Zinxhirin",
  "7 Second": "7 Sekonda",
  "Don't Touch the Black": "Mos Prek të Zezën",
  "Color Merge": "Bashko Ngjyrat",
  Flutter: "Fluturo",
  Updraft: "Fluturo",
  Decant: "Derdhe",
  Scatter: "Shpërndaje",
  Fusebox: "Kutia e Siguresave",
  Minefield: "Fusha e Minuar",

  // Taglines
  "Place a crown in every row, column and colour region, with no two touching. Every board has one solution, the boards keep coming, and the quick earn more.":
    "Vendos një kurorë në çdo rresht, kolonë dhe zonë ngjyre, pa u prekur me njëra-tjetrën. Çdo tabelë ka një zgjidhje, tabelat vijnë pa pushim, dhe të shpejtët fitojnë më shumë.",
  "Every board is split into coloured regions. Place exactly one crown in each row, each column and each region; two crowns can never touch, not even diagonally. Tap a cell once for an X, twice for a crown, and a third time to clear it. Undo takes back any tap and Clear board starts the board again, for free. Crowns that break the rules turn red. Each solved board is worth ten points a row, the boards grow from 5×5 to 9×9, and there is no clock to lose to: beating a board's par time earns a speed bonus when you end the run, up to double.":
    "Çdo tabelë ndahet në zona me ngjyra. Vendos saktësisht një kurorë në çdo rresht, çdo kolonë dhe çdo zonë; dy kurora nuk mund të preken kurrë, as diagonalisht. Prek një kuti një herë për një X, dy herë për një kurorë dhe herën e tretë për ta pastruar. Zhbëj e kthen çdo prekje dhe Pastro tabelën e nis tabelën nga e para, falas. Kurorat që shkelin rregullat bëhen të kuqe. Çdo tabelë e zgjidhur vlen dhjetë pikë për rresht, tabelat rriten nga 5×5 në 9×9, dhe nuk ka orë që të humbësh prej saj: nëse e mund kohën normale të tabelës, fiton një bonus shpejtësie kur e mbyll lojën, deri në dyfish.",
  "The classic number puzzle with no clock to lose to: fill the grid so every row, column and 3×3 box holds 1 to 9 once each. The quicker you solve, the more you earn.":
    "Enigma klasike me numra, pa orë që të humbësh prej saj: mbush rrjetën që çdo rresht, kolonë dhe kuti 3×3 të mbajë 1 deri në 9 nga një herë. Sa më shpejt ta zgjidhësh, aq më shumë fiton.",
  "Fill the 9×9 grid so that every row, every column and every 3×3 box holds the digits 1 to 9 once each. Select a cell and tap a number to place it, or Erase to clear it; cells that start filled stay as they are, and a digit that repeats in a row, column or box is marked in red. Every solved board is worth ninety points and the boards get harder. There is no clock to lose to: beating a board's par time earns a speed bonus when you end the run, up to double.":
    "Mbush rrjetën 9×9 që çdo rresht, çdo kolonë dhe çdo kuti 3×3 të mbajë shifrat 1 deri në 9 nga një herë. Zgjidh një kuti dhe prek një numër për ta vendosur, ose Fshi për ta pastruar; kutitë që nisin të mbushura mbeten siç janë, dhe një shifër që përsëritet në rresht, kolonë ose kuti shënohet me të kuqe. Çdo tabelë e zgjidhur vlen nëntëdhjetë pikë dhe tabelat vështirësohen. Nuk ka orë që të humbësh prej saj: nëse e mund kohën normale të tabelës, fiton një bonus shpejtësie kur e mbyll lojën, deri në dyfish.",
  "The small Sudoku: a 6×6 grid in boxes two rows tall and three wide, with the digits 1 to 6. Every board has exactly one solution, and the quicker you solve, the more you earn.":
    "Sudoku i vogël: një rrjetë 6×6 me kuti dy rreshta të larta dhe tre të gjera, me shifrat 1 deri në 6. Çdo tabelë ka saktësisht një zgjidhje, dhe sa më shpejt ta zgjidhësh, aq më shumë fiton.",
  "Fill the grid so every row, every column and every 2×3 box holds the digits 1 to 6 once each. Tap a cell, then a digit. A wrong digit never ends a run: fix it and carry on. Every solved board is worth 60 points and the boards get harder. There is no clock to lose to: beating a board's par time earns a speed bonus when you end the run, up to double.":
    "Mbush rrjetën që çdo rresht, çdo kolonë dhe çdo kuti 2×3 të mbajë shifrat 1 deri në 6 nga një herë. Prek një kuti, pastaj një shifër. Një shifër e gabuar nuk e mbyll kurrë lojën: ndreqe dhe vazhdo. Çdo tabelë e zgjidhur vlen 60 pikë dhe tabelat vështirësohen. Nuk ka orë që të humbësh prej saj: nëse e mund kohën normale të tabelës, fiton një bonus shpejtësie kur e mbyll lojën, deri në dyfish.",
  "One tap. One chain reaction.": "Një prekje. Një reaksion zinxhir.",
  "A grid of charged cells, one spark at a time. Pop a cell and its bolts charge the next ones, and the next, in waves worth more each time. Long chains pay your sparks back, so a run is always one good tap from turning around.":
    "Një rrjetë kutish të ngarkuara, një shkëndijë në çdo prekje. Shpërthe një kuti dhe rrufetë e saj ngarkojnë të tjerat, valë pas vale, gjithnjë me më shumë vlerë. Zinxhirët e gjatë t'i kthejnë shkëndijat, ndaj një lojë është gjithmonë një prekje e mirë larg nga kthesa.",
  "Tap a cell to spend a spark and add one charge. At four charge it pops and fires a bolt each way, up to three cells, charging the first charged cell it meets. Each wave of a chain scores more than the last. Four pops from one tap gives back a spark, seven gives two, eleven gives three, and leaving four charged cells or fewer clears the board for three more. Every second board asks for longer chains. Surge cells fire diagonally too from board three; a shielded cell's first hit only breaks its shield from board five. The run ends when the sparks run out.":
    "Prek një kuti për të shpenzuar një shkëndijë dhe për të shtuar një ngarkesë. Me katër ngarkesa ajo shpërthen dhe lëshon një rrufe në çdo drejtim, deri në tri kuti, duke ngarkuar kutinë e parë të ngarkuar që takon. Çdo valë e zinxhirit jep më shumë pikë se e mëparshmja. Katër shpërthime nga një prekje kthejnë një shkëndijë, shtatë kthejnë dy, njëmbëdhjetë kthejnë tri, dhe nëse lë katër kuti të ngarkuara ose më pak, tabela pastrohet për edhe tri. Çdo tabelë e dytë kërkon zinxhirë më të gjatë. Nga tabela e tretë, kutitë e fuqishme lëshojnë rrufe edhe diagonalisht; nga tabela e pestë, goditja e parë te një kuti e mbrojtur vetëm ia thyen mburojën. Loja mbaron kur mbarojnë shkëndijat.",
  "Every number is a clue.": "Çdo numër është një e dhënë.",
  "Open every safe cell of a hidden minefield, reading the numbers to work out where the mines lie. The first tap of a board is always safe, three lives forgive a bad guess, and the boards keep getting bigger and denser.":
    "Hap çdo kuti të sigurt të një fushe të fshehur me mina, duke lexuar numrat për të gjetur ku janë minat. Prekja e parë e një tabele është gjithmonë e sigurt, tri jetë falin një hamendësim të keq, dhe tabelat bëhen gjithnjë më të mëdha dhe më të dendura.",
  "Tap a cell to open it. A number says how many of the eight cells around it hide a mine, and a cell with none opens its neighbours too. Switch to Flag, long-press or right-click to flag a cell you think is a mine. Tap an opened number whose flags add up to open the rest of its neighbours. A mine costs a life, and the run ends when all three are gone. Each safe cell is worth 10 points, a cleared board 20 a row, and a board cleared without setting off a mine 10 more a row. Every third cleared board brings back a life. Boards grow from 8×8 to 10×10 and hold more mines as you go.":
    "Prek një kuti për ta hapur. Një numër tregon sa nga tetë kutitë përreth fshehin një minë, dhe një kuti pa asnjë hap edhe fqinjët e saj. Kalo te Flamuri, bëj prekje të gjatë ose kliko djathtas për të shënuar një kuti që mendon se ka minë. Prek një numër të hapur me flamujt e plotë për të hapur fqinjët e tjerë. Një minë kushton një jetë, dhe loja mbaron kur mbarojnë të trija. Çdo kuti e sigurt vlen 10 pikë, një tabelë e pastruar 20 për rresht, dhe një tabelë e pastruar pa shpërthyer asnjë minë edhe 10 për rresht. Çdo tabelë e tretë e pastruar kthen një jetë. Tabelat rriten nga 8×8 në 10×10 dhe mbajnë më shumë mina ndërsa vazhdon.",
  "Every block escapes. Find the order.": "Çdo bllok del. Gjej radhën.",
  "Clear the way. Every arrow out.": "Hape rrugën. Çdo shigjetë jashtë.",
  "Sudoku on a 6×6 grid.": "Sudoku në rrjetë 6×6.",
  "Pour until every tube is one colour.": "Derdh derisa çdo epruvetë të ketë një ngjyrë.",
  "Tap to rise. Thread the gaps.": "Prek për t'u ngritur. Kalo nëpër hapësira.",
  "Drop the pieces. Fill a line. Watch it burst.":
    "Lësho copat. Mbush një vijë. Shiko si shpërthen.",
  "One crossword a day. Solve it fast.": "Një fjalëkryq në ditë. Zgjidhe shpejt.",
  "One to nine, once in every row, column and box.":
    "Nga një te nëntë, një herë në çdo rresht, kolonë dhe kuti.",
  "Suns and moons. Three of each, every line.": "Diej dhe hëna. Nga tre, në çdo vijë.",
  "Eight tiles. One gap. Slide them home.": "Tetë pllaka. Një hapësirë. Rrëshqiti në vend.",
  "One path. Every cell. Beat the clock.": "Një shteg. Çdo kuti. Mund orën.",
  "One crown per row, column and colour.": "Një kurorë për rresht, kolonë dhe ngjyrë.",
  "One move. One solution.": "Një lëvizje. Një zgjidhje.",
  "Repeat the chain. Add one more.": "Përsërit zinxhirin. Shto edhe një.",
  "Today's challenge. Seven seconds.": "Sfida e sotme. Shtatë sekonda.",
  "See it once. Rebuild it.": "Shihe një herë. Rindërtoje.",
  "Tap white. Only white.": "Prek të bardhën. Vetëm të bardhën.",
  "Slide, merge, keep the board open.": "Rrëshqit, bashko, mbaje tabelën të hapur.",
  "Make every column add up to ten.": "Bëj që çdo kolonë të mblidhet dhjetë.",

  // Descriptions
  "A new micro challenge every day. Signed-in players get one ranked attempt a day; anyone can practise as often as they like.":
    "Një mikrosfidë e re çdo ditë. Lojtarët e identifikuar kanë një përpjekje në renditje në ditë; kushdo mund të ushtrohet sa herë të dojë.",
  "The classic sliding puzzle against the clock. Put the tiles back in order, then do it again, a little more scrambled each time.":
    "Enigma klasike me pllaka rrëshqitëse kundër orës. Renditi pllakat, pastaj bëje sërish, pak më të përziera çdo herë.",
  "Slide the grid, merge equal colors into the next shade. Run out of moves and the board locks.":
    "Rrëshqit rrjetën, bashko ngjyrat e njëjta në nuancën e radhës. Kur mbarojnë lëvizjet, tabela bllokohet.",
  "A new crossword every day, the same for everyone: a 5×5 mini on weekdays and a 7×7 midi at the weekend, with original clues. The faster you solve it, the more it scores.":
    "Një fjalëkryq i ri çdo ditë, i njëjti për të gjithë: një mini 5×5 në ditë pune dhe një midi 7×7 në fundjavë, me përkufizime origjinale. Sa më shpejt ta zgjidhësh, aq më shumë pikë jep.",
  "Place a crown in every row, column and colour region, with no two touching. Every board has one solution, and the boards keep coming.":
    "Vendos një kurorë në çdo rresht, kolonë dhe zonë ngjyre, pa u prekur dy prej tyre. Çdo tabelë ka një zgjidhje, dhe tabelat vazhdojnë të vijnë.",
  "Tubes of stacked colour and two empty ones. Pour from tube to tube until every tube holds a single colour, against a clock that each sorted board winds back. Boards start with three colours and gain one every second board, up to nine.":
    "Epruveta me ngjyra të mbivendosura dhe dy bosh. Derdh nga një epruvetë te tjetra derisa secila të mbajë një ngjyrë të vetme, kundër një ore që çdo tabelë e renditur e kthen mbrapsht. Tabelat nisin me tre ngjyra dhe fitojnë një çdo dy tabela, deri në nëntë.",
  "Watch the sequence, repeat it, survive the next link. Reaction meets memory.":
    "Shiko radhën, përsërite, mbijeto hallkën e radhës. Reagimi takon kujtesën.",
  "Rows scroll faster every second. Touch a black tile or let a white one pass and the run ends.":
    "Rreshtat rrëshqasin më shpejt çdo sekondë. Prek një pllakë të zezë ose lër të kalojë një të bardhë dhe loja mbaron.",
  "An 8×8 grid and three pieces at a time. Fill a whole row or column and it bursts; burst again soon after and the combo multiplies your points. The pieces get bigger as you go, and the run ends when nothing in your tray fits.":
    "Një rrjetë 8×8 dhe tri copa njëherësh. Mbush një rresht ose kolonë të plotë dhe ajo shpërthen; shpërthe sërish menjëherë dhe kombinimi i shumëfishon pikët. Copat rriten ndërsa vazhdon, dhe loja mbaron kur asgjë nga copat nuk përshtatet.",
  "Coloured blocks, a few walls, and a gate of each colour in the frame. Drag a block and it slides until something stops it; line it up with its own gate and it slips out. Blocks stand in each other's way, so every board is a puzzle about order, against a clock that each cleared board winds back.":
    "Blloqe me ngjyra, disa mure dhe një portë për çdo ngjyrë në kornizë. Tërhiq një bllok dhe ai rrëshqet derisa diçka ta ndalë; drejtoje me portën e vet dhe ai del jashtë. Blloqet i zënë rrugën njëri-tjetrit, ndaj çdo tabelë është një enigmë radhe, kundër një ore që çdo tabelë e pastruar e kthen mbrapsht.",
  "A pattern flashes for a moment, a little shorter every round. Rebuild it cell by cell.":
    "Një model ndriçon për një çast, pak më shkurt çdo raund. Rindërtoje kuti pas kutie.",
  "The small Sudoku: a 6×6 grid in boxes two rows tall and three wide, with the digits 1 to 6. Every board has exactly one solution, and every solved board winds the clock back.":
    "Sudoku i vogël: një rrjetë 6×6 me kuti dy rreshta të larta dhe tre të gjera, me shifrat 1 deri në 6. Çdo tabelë ka saktësisht një zgjidhje, dhe çdo tabelë e zgjidhur e kthen orën mbrapsht.",
  "Each level has exactly one move that solves it. Find it.":
    "Çdo nivel ka saktësisht një lëvizje që e zgjidh. Gjeje.",
  "A grid of arrow tiles, each one aching to leave. Tap a tile and it flies off the way it points, as long as nothing is in its lane. Turnstiles turn with every escape, so the order you clear the board in matters. Boards grow and crowd up as you go.":
    "Një rrjetë pllakash me shigjeta, secila që pret të ikë. Prek një pllakë dhe ajo fluturon nga ana ku tregon, për sa kohë asgjë nuk është në rrugën e saj. Rrotullueset kthehen me çdo dalje, ndaj radha në të cilën e pastron tabelën ka rëndësi. Tabelat rriten dhe mbushen ndërsa vazhdon.",
  "Drop numbered tiles into columns. Hit exactly ten to clear. Overflow and it is over.":
    "Lësho pllaka me numra në kolona. Arri saktësisht dhjetë për të pastruar. Kalo mbi të dhe mbaroi.",
  "The classic number puzzle, against the clock: fill the grid so every row, column and 3×3 box holds 1 to 9 once each. Every solved board buys more time.":
    "Enigma klasike me numra, kundër orës: mbush rrjetën që çdo rresht, kolonë dhe kuti 3×3 të mbajë 1 deri në 9 nga një herë. Çdo tabelë e zgjidhur fiton më shumë kohë.",
  "Fill the grid with suns and moons: three of each in every row and column, never three alike in a row, every sign obeyed. Beat the clock.":
    "Mbush rrjetën me diej dhe hëna: nga tre në çdo rresht dhe kolonë, kurrë tre të njëjta rresht, çdo shenjë e respektuar. Mund orën.",
  "Draw one line through every cell, passing the numbers in order. Every board has one solution, and the clock never stops.":
    "Vizato një vijë nëpër çdo kuti, duke kaluar numrat me radhë. Çdo tabelë ka një zgjidhje, dhe ora nuk ndalet kurrë.",
  "A glider, a stiff breeze and an endless line of columns. Tap to lift, let go to fall, and thread the gap in every column. The wind picks up and the gaps narrow as you go; one touch of a column or the ground and the run is over.":
    "Një avion pa motor, një erë e fortë dhe një varg i pafund kolonash. Prek për t'u ngritur, lësho për të rënë, dhe kalo nëpër hapësirën e çdo kolone. Era forcohet dhe hapësirat ngushtohen ndërsa vazhdon; një prekje e një kolone ose e tokës dhe loja mbaroi.",

  // Instructions
  "Seven seconds on the clock. Answer the arithmetic challenge with the right number: tap it, or press 1, 2 or 3. Every correct answer adds 1.5 seconds and 10 points; every wrong answer costs 2 seconds. When the clock reaches zero the run ends. Everyone gets the same deck each UTC day, and one ranked attempt a day — guests can practise, unranked.":
    "Shtatë sekonda në orë. Përgjigju sfidës aritmetike me numrin e saktë: prekë, ose shtyp 1, 2 ose 3. Çdo përgjigje e saktë shton 1.5 sekonda dhe 10 pikë; çdo përgjigje e gabuar kushton 2 sekonda. Kur ora arrin zero loja mbaron. Të gjithë marrin të njëjtën pako çdo ditë UTC, dhe një përpjekje në renditje në ditë — mysafirët mund të ushtrohen pa renditje.",
  "Seven seconds on the clock. Answer the arithmetic challenge with the right number: tap it, or press 1, 2 or 3. Every correct answer adds 1.5 seconds and 10 points; every wrong answer costs 2 seconds. When the clock reaches zero the run ends. Everyone gets the same deck each day, and one ranked attempt a day — guests can practise, unranked.":
    "Shtatë sekonda në orë. Përgjigju sfidës aritmetike me numrin e saktë: prekë, ose shtyp 1, 2 ose 3. Çdo përgjigje e saktë shton 1.5 sekonda dhe 10 pikë; çdo përgjigje e gabuar kushton 2 sekonda. Kur ora arrin zero loja mbaron. Të gjithë marrin të njëjtën pako çdo ditë, dhe një përpjekje në renditje në ditë — mysafirët mund të ushtrohen pa renditje.",
  "Tap a tile next to the gap to slide it in, or use the arrow keys. Put the tiles in order, 1 to 8 in reading order with the gap in the bottom-right corner. Every board can be solved, and each is scrambled a little more than the last. The clock starts at 75 seconds and every solved board adds ten points and time: 18 seconds for the first, less with each board after, down to 7.5. The run ends when the clock runs out or when you end it.":
    "Prek një pllakë pranë hapësirës për ta rrëshqitur aty, ose përdor shigjetat. Rendit pllakat, 1 deri në 8 sipas radhës së leximit me hapësirën në këndin e poshtëm djathtas. Çdo tabelë mund të zgjidhet, dhe secila është pak më e përzier se e mëparshmja. Ora nis me 75 sekonda dhe çdo tabelë e zgjidhur shton dhjetë pikë dhe kohë: 18 sekonda për të parën, më pak për secilën pas saj, deri në 7.5. Loja mbaron kur mbaron ora ose kur e mbyll ti.",
  "Slide the whole board with the arrow keys, WASD or a swipe. Equal neighbours merge into the next shade, and each tile merges once per slide. There is no final slide: the run ends only when the board locks, with every cell full and no matching neighbours. New tiles arrive with a growing chance of a higher shade, so the space you have keeps shrinking — keep merging to survive.":
    "Rrëshqit gjithë tabelën me shigjetat, WASD ose një rrëshqitje gishti. Fqinjët e njëjtë bashkohen në nuancën e radhës, dhe çdo pllakë bashkohet një herë për rrëshqitje. Nuk ka rrëshqitje të fundit: loja mbaron vetëm kur tabela bllokohet, me çdo kuti plot dhe pa fqinjë të njëjtë. Pllakat e reja vijnë me mundësi në rritje për nuancë më të lartë, ndaj hapësira vjen duke u ngushtuar — vazhdo të bashkosh për të mbijetuar.",
  "Fill the grid so every across and down answer fits its clue. Pick a square and type; pick it again, or tap the clue, to switch direction. A mini is worth 1000 if solved within 30 seconds and a midi 2000 within a minute, then four points fewer a second. Checking the grid costs 50 and revealing a letter 100. One ranked solve a day; a new crossword arrives at midnight UTC.":
    "Mbush rrjetën që çdo përgjigje horizontale dhe vertikale të përputhet me përkufizimin. Zgjidh një katror dhe shkruaj; zgjidhe sërish, ose prek përkufizimin, për të ndërruar drejtimin. Një mini vlen 1000 nëse zgjidhet brenda 30 sekondave dhe një midi 2000 brenda një minute, pastaj katër pikë më pak në sekondë. Kontrolli i rrjetës kushton 50 dhe zbulimi i një shkronje 100. Një zgjidhje në renditje në ditë; një fjalëkryq i ri vjen në mesnatë UTC.",
  "Fill the grid so every across and down answer fits its clue. Pick a square and type; pick it again, or tap the clue, to switch direction. A mini is worth 1000 if solved within 30 seconds and a midi 2000 within a minute, then four points fewer a second. Checking the grid costs 50 and revealing a letter 100. One ranked solve a day; a new crossword arrives at midnight, your time.":
    "Mbush rrjetën që çdo përgjigje horizontale dhe vertikale të përputhet me përkufizimin. Zgjidh një katror dhe shkruaj; zgjidhe sërish, ose prek përkufizimin, për të ndërruar drejtimin. Një mini vlen 1000 nëse zgjidhet brenda 30 sekondave dhe një midi 2000 brenda një minute, pastaj katër pikë më pak në sekondë. Kontrolli i rrjetës kushton 50 dhe zbulimi i një shkronje 100. Një zgjidhje në renditje në ditë; një fjalëkryq i ri vjen në mesnatë, sipas orës sate.",
  "Every board is split into coloured regions. Place exactly one crown in each row, each column and each region; two crowns can never touch, not even diagonally. Tap a cell once for an X, twice for a crown, and a third time to clear it. A crown off the solution is a mistake, and the third mistake ends the run. Each solved board is worth ten points a row, the boards grow from 5×5 to 9×9, and you can end the run whenever you like.":
    "Çdo tabelë është e ndarë në zona me ngjyra. Vendos saktësisht një kurorë në çdo rresht, çdo kolonë dhe çdo zonë; dy kurora nuk mund të prekin kurrë njëra-tjetrën, as diagonalisht. Prek një kuti një herë për X, dy herë për kurorë, dhe herën e tretë për ta pastruar. Një kurorë jashtë zgjidhjes është gabim, dhe gabimi i tretë e mbyll lojën. Çdo tabelë e zgjidhur vlen dhjetë pikë për rresht, tabelat rriten nga 5×5 në 9×9, dhe mund ta mbyllësh lojën kur të duash.",
  "Tap a tube, then the tube to pour it into. A pour only lands on an empty tube or on the same colour, and the whole top layer of that colour goes, as much as fits. Sort every tube into one colour to solve the board: 10 points and about 5 more seconds per colour: a little more early on, less as the run goes. Undo a pour, restart the board, or add one empty tube to it for 15 seconds of clock. The run ends when the clock does.":
    "Prek një epruvetë, pastaj epruvetën ku do ta derdhësh. Një derdhje bie vetëm në një epruvetë bosh ose mbi të njëjtën ngjyrë, dhe shkon gjithë shtresa e sipërme e asaj ngjyre, aq sa nxë. Rendit çdo epruvetë në një ngjyrë për ta zgjidhur tabelën: 10 pikë dhe rreth 5 sekonda më shumë për ngjyrë: pak më shumë në fillim, më pak ndërsa loja vazhdon. Zhbëj një derdhje, rinis tabelën, ose shto një epruvetë bosh për 15 sekonda nga ora. Loja mbaron kur mbaron ora.",
  "Watch the flashing sequence, then tap the pads back in the same order. Every round adds one more step and the beat gets a little quicker, with no final round — keep going until a wrong tap breaks the chain. Each correct tap scores one point, and the taps you got are your score.":
    "Shiko radhën që ndriçon, pastaj prek butonat në të njëjtën radhë. Çdo raund shton edhe një hap dhe ritmi shpejtohet pak, pa raund të fundit — vazhdo derisa një prekje e gabuar ta këputë zinxhirin. Çdo prekje e saktë jep një pikë, dhe prekjet që arrite janë rezultati yt.",
  "Rows rise to a line. Tap every white tile in the row at the line before the row passes, and never touch a black one. A black tap ends the run, and so does a white tile that slips past the line. There is no final row: the conveyor keeps speeding up and every row grows a little blacker, so keep going until you slip or choose to stop. Each white tile scores ten points, and the tiles you cleared are your score.":
    "Rreshtat ngjiten deri te një vijë. Prek çdo pllakë të bardhë në rreshtin te vija para se rreshti të kalojë, dhe mos prek kurrë një të zezë. Një prekje e zezë e mbyll lojën, po ashtu edhe një pllakë e bardhë që kalon vijën. Nuk ka rresht të fundit: shiriti vazhdon të shpejtohet dhe çdo rresht nxihet pak më shumë, ndaj vazhdo derisa të gabosh ose të vendosësh të ndalesh. Çdo pllakë e bardhë jep dhjetë pikë, dhe pllakat që pastrove janë rezultati yt.",
  "Drag a piece from the tray onto the grid, or tap a piece and then a square. A full row or column bursts. Every square placed is a point; a burst of L lines scores 10 × L² times your combo, which grows with every burst and resets after three placements without one. Empty the whole board for 300 more. Place all three pieces and three more arrive; the run ends when none of them fits.":
    "Tërhiq një copë nga grupi në rrjetë, ose prek një copë dhe pastaj një katror. Një rresht ose kolonë e plotë shpërthen. Çdo katror i vendosur është një pikë; një shpërthim me L vija jep 10 × L² herë kombinimin, i cili rritet me çdo shpërthim dhe rinis pas tri vendosjesh pa shpërthim. Zbraz gjithë tabelën për 300 të tjera. Vendos të tria copat dhe vijnë edhe tri; loja mbaron kur asnjëra nuk përshtatet.",
  "Drag a block up, down, left or right and it slides until a wall, another block or the edge stops it. A block that reaches a gate of its own colour, lined up so the gate covers its whole width, leaves the board. Clear every block for 10 points each and time for the next board; undo or restart a board any time. The clock starts at 75 seconds, the boards grow trickier, and the time they add tightens as the run goes. The run ends when the clock runs out or when you end it.":
    "Tërhiq një bllok lart, poshtë, majtas ose djathtas dhe ai rrëshqet derisa ta ndalë një mur, një bllok tjetër ose skaji. Një bllok që arrin një portë të ngjyrës së vet, i drejtuar që porta të mbulojë gjithë gjerësinë e tij, del nga tabela. Pastro çdo bllok për 10 pikë secili dhe kohë për tabelën tjetër; zhbëj ose rinis një tabelë kur të duash. Ora nis me 75 sekonda, tabelat vështirësohen, dhe koha që shtojnë ngushtohet ndërsa loja vazhdon. Loja mbaron kur mbaron ora ose kur e mbyll ti.",
  "Watch the pattern, then rebuild it in any order. One wrong or repeated cell ends the run. There is no final pattern: every round adds a cell, the board grows when the pattern outgrows it, and the flash gets shorter. Ten points a round.":
    "Shiko modelin, pastaj rindërtoje në çfarëdo radhe. Një kuti e gabuar ose e përsëritur e mbyll lojën. Nuk ka model të fundit: çdo raund shton një kuti, tabela rritet kur modeli nuk nxë më, dhe ndriçimi shkurtohet. Dhjetë pikë për raund.",
  "Fill the grid so every row, every column and every 2×3 box holds the digits 1 to 6 once each. Tap a cell, then a digit. Solve a board for 60 points and time for the next one: the clock starts at two minutes, and each board adds time, generous early on and tighter as the run goes. A wrong digit never ends a run; the clock does.":
    "Mbush rrjetën që çdo rresht, çdo kolonë dhe çdo kuti 2×3 të mbajë shifrat 1 deri në 6 nga një herë. Prek një kuti, pastaj një shifër. Zgjidh një tabelë për 60 pikë dhe kohë për tjetrën: ora nis me dy minuta, dhe çdo tabelë shton kohë, bujarisht në fillim dhe më ngushtë ndërsa loja vazhdon. Një shifër e gabuar nuk e mbyll kurrë lojën; ora po.",
  "Every board is a checkerboard with exactly one move already made. A move flips one cell and the neighbours above, below, left and right of it that are on the board. Tap the cell that restores the checkerboard; any other tap ends the run. There is no final board: every four boards the grid grows by a row and a column. Ten points a board.":
    "Çdo tabelë është një fushë shahu me saktësisht një lëvizje të bërë tashmë. Një lëvizje kthen një kuti dhe fqinjët sipër, poshtë, majtas dhe djathtas saj që janë në tabelë. Prek kutinë që e rikthen fushën e shahut; çdo prekje tjetër e mbyll lojën. Nuk ka tabelë të fundit: çdo katër tabela rrjeta rritet me një rresht dhe një kolonë. Dhjetë pikë për tabelë.",
  "Tap a tile and it flies off the board the way its arrow points, for 10 points, as long as nothing stands between it and the edge. A blocked tile jams and stays put; three jams end the run. Tiles with a turnstile badge turn a quarter clockwise every time a tile escapes. Clear a board for 50 more and the next one deals, bigger and busier; a board where no tile can leave is lost for a jam. There is no last board, and you can end the run any time.":
    "Prek një pllakë dhe ajo fluturon jashtë tabelës nga ana ku tregon shigjeta, për 10 pikë, për sa kohë asgjë nuk qëndron mes saj dhe skajit. Një pllakë e bllokuar ngec dhe mbetet aty; tre bllokime e mbyllin lojën. Pllakat me shenjën e rrotulluesit kthehen një çerek në drejtim të orës sa herë del një pllakë. Pastro një tabelë për 50 të tjera dhe vjen tjetra, më e madhe dhe më e mbushur; një tabelë ku asnjë pllakë nuk mund të dalë humbet si bllokim. Nuk ka tabelë të fundit, dhe mund ta mbyllësh lojën kur të duash.",
  "Place the numbered tile in one of four columns. A column that adds up to exactly ten clears and scores; a column that goes past ten ends the run. There is no final tile: the first sixty tiles are the old deck, and from there tiles arrive with a growing chance of a heavier face, so clears get rarer and the board gets tighter. Keep the sums exact.":
    "Vendos pllakën me numër në një nga katër kolonat. Një kolonë që mblidhet saktësisht dhjetë pastrohet dhe jep pikë; një kolonë që kalon dhjetën e mbyll lojën. Nuk ka pllakë të fundit: gjashtëdhjetë pllakat e para janë pakoja e vjetër, dhe prej aty vijnë pllaka me mundësi në rritje për vlerë më të rëndë, ndaj pastrimet rrallohen dhe tabela ngushtohet. Mbaji shumat të sakta.",
  "Fill the 9×9 grid so that every row, every column and every 3×3 box holds the digits 1 to 9 once each; every board has exactly one solution. Select a cell and tap a number to place it, or Erase to clear it; cells that start filled stay as they are, and a digit that repeats in a row, column or box is marked in red. Turn on Notes to jot candidate digits, and Undo to step back. Boards start gentle and get harder: the clock starts at 6:40, and every solved board scores ninety points and adds time for the next board: generous early on, tighter as the run goes. The run ends when the clock runs out or when you end it.":
    "Mbush rrjetën 9×9 që çdo rresht, çdo kolonë dhe çdo kuti 3×3 të mbajë shifrat 1 deri në 9 nga një herë; çdo tabelë ka saktësisht një zgjidhje. Zgjidh një kuti dhe prek një numër për ta vendosur, ose Fshi për ta pastruar; kutitë që nisin të mbushura mbeten siç janë, dhe një shifër që përsëritet në rresht, kolonë ose kuti shënohet me të kuqe. Aktivizo Shënimet për të shkruar shifra të mundshme, dhe Zhbëj për të kthyer një hap. Tabelat nisin të lehta dhe vështirësohen: ora nis me 6:40, dhe çdo tabelë e zgjidhur jep nëntëdhjetë pikë dhe shton kohë për tjetrën: bujarisht në fillim, më ngushtë ndërsa loja vazhdon. Loja mbaron kur mbaron ora ose kur e mbyll ti.",
  "Fill the 6×6 grid with suns and moons. Every row and every column holds three of each, and no three alike sit next to each other across or down. An = between two cells means they match; an × means they differ. Tap a cell for a sun, again for a moon, once more to clear it; cells that start filled stay as they are. The clock starts at 2:20 and every solved board adds sixty points and time: 54 seconds for the first, less with each board after, down to 22.5. Each board starts with fewer cells filled, and the run ends when the clock runs out or when you end it.":
    "Mbush rrjetën 6×6 me diej dhe hëna. Çdo rresht dhe çdo kolonë mban nga tre, dhe asnjë treshe e njëjtë nuk qëndron njëra pas tjetrës horizontalisht ose vertikalisht. Një = mes dy kutive do të thotë se përputhen; një × se ndryshojnë. Prek një kuti për diell, sërish për hënë, edhe një herë për ta pastruar; kutitë që nisin të mbushura mbeten siç janë. Ora nis me 2:20 dhe çdo tabelë e zgjidhur shton gjashtëdhjetë pikë dhe kohë: 54 sekonda për të parën, më pak për secilën pas saj, deri në 22.5. Çdo tabelë nis me më pak kuti të mbushura, dhe loja mbaron kur mbaron ora ose kur e mbyll ti.",
  "Draw one path that starts on 1, passes through every number in order and ends on the highest, visiting every cell exactly once. Move up, down, left or right, never through a wall. Drag or tap to extend the path, and go back over it to undo. The clock starts at 75 seconds and every solved board adds about five seconds a row: a little more early on, less as the run goes. Each board is worth ten points a row, the boards grow from 5×5 to 7×7, and the run ends when the clock runs out or when you end it.":
    "Vizato një shteg që nis te 1, kalon nëpër çdo numër me radhë dhe mbaron te më i madhi, duke kaluar në çdo kuti saktësisht një herë. Lëviz lart, poshtë, majtas ose djathtas, kurrë përmes një muri. Tërhiq ose prek për ta zgjatur shtegun, dhe kthehu mbi të për ta zhbërë. Ora nis me 75 sekonda dhe çdo tabelë e zgjidhur shton rreth pesë sekonda për rresht: pak më shumë në fillim, më pak ndërsa loja vazhdon. Çdo tabelë vlen dhjetë pikë për rresht, tabelat rriten nga 5×5 në 7×7, dhe loja mbaron kur mbaron ora ose kur e mbyll ti.",
  "Tap, click or press Space to flap: each flap lifts the glider, and between flaps it falls. Fly through the gap in each column for 10 points. Touching a column or the ground ends the run; the top of the sky is safe. The field speeds up and the gaps narrow as you go, with no last column.":
    "Prek, kliko ose shtyp Space për të përplasur krahët: çdo përplasje e ngre avionin, dhe mes përplasjeve ai bie. Fluturo nëpër hapësirën e çdo kolone për 10 pikë. Prekja e një kolone ose e tokës e mbyll lojën; maja e qiellit është e sigurt. Fusha shpejtohet dhe hapësirat ngushtohen ndërsa vazhdon, pa kolonë të fundit.",

  // Categories
  Puzzle: "Enigmë",
  Arcade: "Arkadë",
  Logic: "Logjikë",
  Reaction: "Reagim",
  Memory: "Kujtesë",
  Daily: "Ditore",
  Word: "Fjalë",
  Strategy: "Strategji",
  "Fit, merge and clear under pressure.": "Përshtat, bashko dhe pastro nën presion.",
  "Fast reflexes, one wrong tap and it is over.":
    "Reflekse të shpejta, një prekje e gabuar dhe mbaroi.",
  "One correct move per level.": "Një lëvizje e saktë për nivel.",
  "Speed and pattern chains.": "Shpejtësi dhe zinxhirë modelesh.",
  "See it once, rebuild it.": "Shihe një herë, rindërtoje.",
  "One attempt per day.": "Një përpjekje në ditë.",
  "Letters, anagrams and word chains.": "Shkronja, anagrama dhe zinxhirë fjalësh.",
  "Fewer moves, better plan.": "Më pak lëvizje, plan më i mirë.",

  // Stored values shown on admin badges
  published: "e publikuar",
  review: "në shqyrtim",
  draft: "draft",
  rejected: "e refuzuar",
  archived: "e arkivuar",
  open: "e hapur",
  reviewing: "në shqyrtim",
  resolved: "e zgjidhur",
  dismissed: "e hedhur poshtë",
  game: "lojë",
  comment: "koment",
  profile: "profil",
  user: "lojtar",
  moderator: "moderator",
  admin: "administrator",
  unmeasured: "e pamatur",
  // Guesswork (Gjeje)
  Guesswork: "Gjeje",
  "One hidden word a day. Six tries.": "Një fjalë e fshehur në ditë. Gjashtë përpjekje.",
  "Find the day's five-letter word in six guesses. Every guess shows which letters are in the right place, which are in the word somewhere else, and which are not in it at all. The same word for everyone, in English or, in Albanian, as Gjeje.":
    "Gjej fjalën e ditës me pesë shkronja në gjashtë përpjekje. Çdo përpjekje tregon cilat shkronja janë në vendin e duhur, cilat janë në fjalë diku tjetër dhe cilat nuk janë fare. E njëjta fjalë për të gjithë, me fjalë shqipe kur loja është në shqip.",
  "Type a five-letter word and press Enter. Each letter is marked: filled for the right place, outlined for in the word but elsewhere, faded for not in the word. Every guess must be a real word from the list. Solve it in fewer guesses for more points: 600 on the first guess down to 100 on the sixth. One ranked play a day; a new word arrives at midnight, your time.":
    "Shkruaj një fjalë me pesë shkronja dhe shtyp Dërgo. Çdo shkronjë shënohet: e mbushur për vendin e duhur, me kontur për në fjalë por diku tjetër, e zbehur për jo në fjalë. Çdo përpjekje duhet të jetë fjalë e vërtetë nga lista. Gjeje me më pak përpjekje për më shumë pikë: 600 në përpjekjen e parë deri në 100 në të gjashtën. Një lojë e renditur në ditë; fjala e re vjen në mesnatë, sipas orës tënde.",
  // Whittle
  "Cross numbers out until every sum fits.": "Hiq numra derisa çdo shumë të dalë.",
  "A 5×5 grid of numbers with a target beside every row and under every column. Cross numbers out until what is left in each row and each column adds up to its target. The numbers get bigger as you go, and a quick solve earns a speed bonus.":
    "Një rrjetë 5×5 me numra, me një objektiv pranë çdo rreshti dhe poshtë çdo kolone. Hiq numra derisa ajo që mbetet në çdo rresht dhe çdo kolonë të mblidhet sa objektivi i vet. Numrat rriten ndërsa vazhdon, dhe një zgjidhje e shpejtë jep bonus shpejtësie.",
  "Tap a number to cross it out; tap again to circle it as one to keep, and once more to clear it. A target lights up when its row or column adds up to it. Every solved board scores 500 points. Beat a board's par time for a speed bonus of up to double, and end the run whenever you like.":
    "Prek një numër për ta hequr; preke sërish për ta rrethuar si një që mbahet, dhe edhe një herë për ta pastruar. Objektivi ndizet kur rreshti ose kolona e tij mblidhet sa ai. Çdo tabelë e zgjidhur jep 500 pikë. Munde kohën par të një tabele për bonus shpejtësie deri në dyfish, dhe mbylle lojën kur të duash.",
};
