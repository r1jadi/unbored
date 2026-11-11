/** Albanian for the game screens: runs, boards, results and the feed around them. */
export const sqGames: Record<string, string> = {
  " This run was already recorded, so nothing was counted twice.":
    " Kjo lojë ishte regjistruar tashmë, ndaj asgjë nuk u numërua dy herë.",
  "This run was already recorded, so nothing was counted twice.":
    "Kjo lojë ishte regjistruar tashmë, ndaj asgjë nuk u numërua dy herë.",
  " This solve was already recorded, so nothing was counted twice.":
    " Kjo zgjidhje ishte regjistruar tashmë, ndaj asgjë nuk u numërua dy herë.",
  "{error} Nothing was saved, and nothing needs to be — sending the same run again is safe.":
    "{error} Asgjë nuk u ruajt, dhe nuk ka nevojë — dërgimi sërish i së njëjtës lojë është i sigurt.",
  "{error} Nothing was saved. Sending it again is safe; the server times the solve itself, so a later retry scores a little less.":
    "{error} Asgjë nuk u ruajt. Dërgimi sërish është i sigurt; serveri e mat vetë kohën e zgjidhjes, ndaj një provë e mëvonshme jep pak më pak pikë.",
  "{error} Nothing was saved. Sending the same run again is safe, but a timed run has to reach the server soon after its clock runs out.":
    "{error} Asgjë nuk u ruajt. Dërgimi sërish i së njëjtës lojë është i sigurt, por një lojë me kohë duhet të arrijë te serveri menjëherë pasi t'i mbarojë ora.",
  "{tilesPlaced} taps placed, {clearedColumns} rounds cleared.":
    "{tilesPlaced} prekje, {clearedColumns} raunde të kaluara.",
  "{tilesPlaced} cells tapped, {clearedColumns} rounds cleared.":
    "{tilesPlaced} kuti të prekura, {clearedColumns} raunde të kaluara.",
  "{tilesPlaced} tiles placed, {clearedColumns} columns cleared.":
    "{tilesPlaced} pllaka të vendosura, {clearedColumns} kolona të pastruara.",
  "A column passed ten after {tilesPlaced} tiles; {clearedColumns} columns cleared.":
    "Një kolonë kaloi dhjetën pas {tilesPlaced} pllakash; {clearedColumns} kolona të pastruara.",
  "{clearedColumns} {n} sorted, {tilesPlaced} {n2}.":
    "{clearedColumns} {n} të renditura, {tilesPlaced} {n2}.",
  "{clearedColumns} {n} cleared, {tilesPlaced} {n2}.":
    "{clearedColumns} {n} të pastruara, {tilesPlaced} {n2}.",
  "{clearedColumns} {n} solved.": "{clearedColumns} {n} të zgjidhura.",
  "{tilesPlaced} {n}, {clearedColumns} {n2} solved.":
    "{tilesPlaced} {n}, {clearedColumns} {n2} të zgjidhura.",
  "{tilesPlaced} {n}, {clearedColumns} {n2} restored.":
    "{tilesPlaced} {n}, {clearedColumns} {n2} të rikthyera.",
  "{tilesPlaced} {n} sent off, {clearedColumns} {n2} cleared.":
    "{tilesPlaced} {n} të nisura jashtë, {clearedColumns} {n2} të pastruara.",
  "Chain broken": "Zinxhiri u këput",
  "Couldn't start a run": "Loja nuk mund të nisej",
  Duration: "Kohëzgjatja",
  "Every round adds a tap and tightens the beat. A wrong tap ends the run.":
    "Çdo raund shton një prekje dhe e shpejton ritmin. Një prekje e gabuar e mbyll lojën.",
  "Guest run": "Lojë si mysafir",
  "Offline practice": "Ushtrim pa internet",
  Pads: "Butonat",
  Rank: "Vendi",
  Ranked: "Në renditje",
  Round: "Raund",
  "Round {round}": "Raundi {round}",
  "Round {round}: watch {round2} {n}…": "Raundi {round}: shiko {round2} {n}…",
  "Rounds cleared": "Raunde të kaluara",
  "Run ended": "Loja mbaroi",
  "Run ended.": "Loja mbaroi.",
  "Run over": "Loja mbaroi",
  Score: "Pikët",
  "Start a new run": "Nis një lojë të re",
  "Starting a run…": "Po niset loja…",
  tap: "prekje",
  taps: "prekje",
  "The taps so far are your score if the server agrees.":
    "Prekjet deri tani janë pikët e tua, nëse serveri pajtohet.",
  "Top speed: the beat stops getting faster.": "Shpejtësia maksimale: ritmi nuk shpejtohet më.",
  "Try submitting again": "Provo ta dërgosh sërish",
  "Verified by replaying your taps on the server, then saved to the leaderboard.":
    "U verifikua duke riluajtur prekjet e tua në server, pastaj u ruajt në renditje.",
  "Verified by replaying your taps on the server. This was a guest run, so it is not on the leaderboard.":
    "U verifikua duke riluajtur prekjet e tua në server. Kjo ishte lojë si mysafir, ndaj nuk është në renditje.",
  "Verifying your run with the server…": "Po verifikohet loja jote me serverin…",
  "Your best": "Rekordi yt",
  "Your run was not verified": "Loja jote nuk u verifikua",
  "Your turn — repeat {round} {n}.": "Radha jote — përsërit {round} {n}.",
  ", best tile": ", pllaka më e mirë",
  "Back to {title}": "Kthehu te {title}",
  "Board — {slides} slides played": "Tabela — {slides} rrëshqitje të luajtura",
  "Color Merge board. Use the arrow keys to slide.":
    "Tabela e Bashko Ngjyrat. Përdor shigjetat për të rrëshqitur.",
  "Guest run: verified, but not ranked": "Lojë si mysafir: e verifikuar, por jo në renditje",
  "Next tile: {promotionPercent}% chance it arrives as a {promotedValue}. Each tile merges once per slide.":
    "Pllaka e radhës: {promotionPercent}% mundësi të vijë si {promotedValue}. Çdo pllakë bashkohet një herë për rrëshqitje.",
  "Row {row} column {column}, {shade}": "Rreshti {row}, kolona {column}, {shade}",
  "Row {row} column {column}, empty": "Rreshti {row}, kolona {column}, bosh",
  "Row {row} column {column}, {n}": "Rreshti {row}, kolona {column}, {n}",
  "Signed in: this run can be ranked": "I identifikuar: kjo lojë mund të hyjë në renditje",
  slide: "rrëshqitje",
  slides: "rrëshqitje",
  "Slide {slides}": "Rrëshqitja {slides}",
  "Slide down": "Rrëshqit poshtë",
  "Slide left": "Rrëshqit majtas",
  "Slide right": "Rrëshqit djathtas",
  "Slide up": "Rrëshqit lart",
  "Slide to merge — best tile {best}.": "Rrëshqit për të bashkuar — pllaka më e mirë {best}.",
  Slides: "Rrëshqitje",
  "Start run": "Nis lojën",
  "Submission limit reached": "U arrit kufiri i dërgimit",
  "Submission limit reached.": "U arrit kufiri i dërgimit.",
  "The board locked": "Tabela u bllokua",
  "The board locked.": "Tabela u bllokua.",
  "The run is over. Your result is on its way.": "Loja mbaroi. Rezultati yt po vjen.",
  "The slides you made are your score if the server agrees.":
    "Rrëshqitjet që bëre janë pikët e tua, nëse serveri pajtohet.",
  "Verified by replaying your slides on the server, then saved to the leaderboard.":
    "U verifikua duke riluajtur rrëshqitjet e tua në server, pastaj u ruajt në renditje.",
  "Verified by replaying your slides on the server. This was a guest run, so it is not on the leaderboard.":
    "U verifikua duke riluajtur rrëshqitjet e tua në server. Kjo ishte lojë si mysafir, ndaj nuk është në renditje.",

  // The crossword (Fjalekryqi in Albanian)
  "{number} {n}: {clue}. Tap to switch direction.":
    "{number} {n}: {clue}. Prek për të ndërruar drejtimin.",
  Across: "Horizontalisht",
  Down: "Vertikalisht",
  "An unsolved crossword scores nothing, and this is today's ranked attempt.":
    "Një fjalëkryq i pazgjidhur nuk jep pikë, dhe kjo është përpjekja jote e sotme në renditje.",
  "An unsolved crossword scores nothing.": "Një fjalëkryq i pazgjidhur nuk jep pikë.",
  "Back to the rules": "Kthehu te rregullat",
  "Black: you had it": "E zezë: e kishe saktë",
  "Blue: left empty": "Blu: e lënë bosh",
  check: "kontroll",
  checks: "kontrolle",
  Check: "Kontrollo",
  "Checking your solve with the server…": "Po kontrollohet zgjidhja jote me serverin…",
  "Couldn't start today's crossword": "Fjalëkryqi i sotëm nuk mund të nisej",
  Delete: "Fshi",
  "Fetching today's crossword…": "Po merret fjalëkryqi i sotëm…",
  Monday: "E hënë",
  Tuesday: "E martë",
  Wednesday: "E mërkurë",
  Thursday: "E enjte",
  Friday: "E premte",
  Saturday: "E shtunë",
  Sunday: "E diel",
  "Give up": "Dorëzohu",
  "Give up today's crossword?": "Të dorëzohesh në fjalëkryqin e sotëm?",
  "Help used": "Ndihma e përdorur",
  "Here's how it solves": "Ja si zgjidhet",
  "In {durationMs}{n}{n2}.": "Për {durationMs}{n}{n2}.",
  "Keep solving": "Vazhdo zgjidhjen",
  "Every square is filled": "Çdo kuti është plotësuar",
  "Some letters aren't right yet, so the crossword isn't solved. Check marks the wrong ones in red (−{penalty}); fix them and it finishes by itself.":
    "Disa shkronja ende nuk janë të sakta, ndaj fjalëkryqi nuk është zgjidhur. Kontrolli i shënon të gabuarat me të kuqe (−{penalty}); ndreqi dhe përfundon vetë.",
  "Finishing now scores nothing, and this is today's ranked attempt.":
    "Nëse përfundon tani nuk merr pikë, dhe kjo është përpjekja jote e renditur për sot.",
  "Finishing now scores nothing.": "Nëse përfundon tani nuk merr pikë.",
  Finish: "Përfundo",
  Keyboard: "Tastiera",
  letter: "shkronjë",
  letters: "shkronja",
  Letter: "Shkronja",
  "Midi 7×7": "Midi 7×7",
  "Mini 5×5": "Mini 5×5",
  "Next clue": "Përkufizimi tjetër",
  "Previous clue": "Përkufizimi i mëparshëm",
  "Not solved today": "I pazgjidhur sot",
  "One ranked solve a day keeps the board a comparison of the same puzzle. {nextPuzzleIn}":
    "Një zgjidhje në renditje në ditë e mban renditjen një krahasim të së njëjtës enigmë. {nextPuzzleIn}",
  "Red: you had it wrong (yours struck through)": "E kuqe: e kishe gabim (e jotja e vijëzuar)",
  "Row {n} column {n2}{n3}, {n4}{n5}{n6}": "Rreshti {n}, kolona {n2}{n3}, {n4}{n5}{n6}",
  "See the leaderboard": "Shiko renditjen",
  "Signed in: today's solve can be ranked, once":
    "I identifikuar: zgjidhja e sotme mund të hyjë në renditje, një herë",
  "Solved · {day}": "I zgjidhur · {day}",
  "Start today's crossword": "Nis fjalëkryqin e sotëm",
  "The answers": "Përgjigjet",
  "The next crossword arrives in {n}{minutes} min.": "Fjalëkryqi tjetër vjen pas {n}{minutes} min.",
  "The solved grid: {join}": "Rrjeta e zgjidhur: {join}",
  Time: "Koha",
  "Time {formatSeconds}": "Koha {formatSeconds}",
  "Today: {today}": "Sot: {today}",
  "Today's crossword, {side} by {side2}": "Fjalëkryqi i sotëm, {side} me {side2}",
  "Verified by replaying your solve on the server, which timed it itself. That was today's ranked attempt.":
    "U verifikua duke riluajtur zgjidhjen tënde në server, i cili e mati vetë kohën. Kjo ishte përpjekja jote e sotme në renditje.",
  "Verified by replaying your solve on the server. This was a guest run, so it is not on the leaderboard.":
    "U verifikua duke riluajtur zgjidhjen tënde në server. Kjo ishte lojë si mysafir, ndaj nuk është në renditje.",
  Word: "Fjala",
  Worth: "Vlen",
  "You had {right} {n} right{n2}{n3}.": "Kishe {right} {n} saktë{n2}{n3}.",
  "You've done today's crossword": "E ke bërë fjalëkryqin e sotëm",
  "Your solve was not verified": "Zgjidhja jote nuk u verifikua",

  // Bolted
  "Add an empty bolt to this board, for {n} seconds of clock":
    "Shto një bulon bosh në këtë tabelë, për {n} sekonda nga ora",
  "Board {level}, {length} bolts. Number keys pick a bolt; U undoes, R restarts the board.":
    "Tabela {level}, {length} bulona. Tastet me numra zgjedhin një bulon; U zhbën, R e rinis tabelën.",
  Bolt: "Bulon",
  "Bolt {n} picked up — tap a bolt to move its nuts there.":
    "Buloni {n} u mor — prek një bulon për t'i çuar dadot aty.",
  "Bolt {n}{n2}: {n3}{n4}{n5}{n6}": "Buloni {n}{n2}: {n3}{n4}{n5}{n6}",
  "Tap a bolt, then the bolt to move its top nuts onto.":
    "Prek një bulon, pastaj bulonin ku do t'i çosh dadot e sipërme.",

  // Decant
  "Add an empty tube to this board, for {n} seconds of clock":
    "Shto një epruvetë bosh në këtë tabelë, për {n} sekonda nga ora",
  board: "tabelë",
  boards: "tabela",
  Board: "Tabela",
  "Board {level}": "Tabela {level}",
  "Board {level}, {length} tubes. Number keys pick a tube; U undoes, R restarts the board.":
    "Tabela {level}, {length} epruveta. Tastet me numra zgjedhin një epruvetë; U zhbën, R e rinis tabelën.",
  "Board {n} sorted, +{points}.": "Tabela {n} u rendit, +{points}.",
  "Boards sorted": "Tabela të renditura",
  "colours ·": "ngjyra ·",
  "End run": "Mbyll lojën",
  "End this run?": "Ta mbyllësh këtë lojë?",
  "Keep playing": "Vazhdo lojën",
  "One more colour from here.": "Një ngjyrë më shumë nga këtu.",
  pour: "derdhje",
  pours: "derdhje",
  Restart: "Rinis",
  "Solving this board adds {formatClockGain}.": "Zgjidhja e kësaj tabele shton {formatClockGain}.",
  "Tap a tube, then the tube to pour it into.":
    "Prek një epruvetë, pastaj epruvetën ku do ta derdhësh.",
  "The pours you made are your score if the server agrees.":
    "Derdhjet që bëre janë pikët e tua, nëse serveri pajtohet.",
  "Time left": "Koha e mbetur",
  "Time's up": "Mbaroi koha",
  "Time's up.": "Mbaroi koha.",
  Tube: "Epruveta",
  "Tube {n} picked up — tap a tube to pour into it.":
    "Epruveta {n} u mor — prek një epruvetë për ta derdhur aty.",
  "Tube {n}{n2}: {n3}{n4}{n5}{n6}": "Epruveta {n}{n2}: {n3}{n4}{n5}{n6}",
  Undo: "Zhbëj",
  "Verified by replaying your pours on the server, then saved to the leaderboard.":
    "U verifikua duke riluajtur derdhjet e tua në server, pastaj u ruajt në renditje.",
  "Verified by replaying your pours on the server. This was a guest run, so it is not on the leaderboard.":
    "U verifikua duke riluajtur derdhjet e tua në server. Kjo ishte lojë si mysafir, ndaj nuk është në renditje.",
  "Your score of {score} is kept and sent for verification. The board you are on is not scored.":
    "Rezultati yt prej {score} pikësh ruhet dhe dërgohet për verifikim. Tabela ku je nuk llogaritet.",
  "Your score of {score} is kept as practice: offline runs are not verified or saved.":
    "Rezultati yt prej {score} pikësh mbetet si ushtrim: lojërat pa internet nuk verifikohen dhe nuk ruhen.",
  "Your score of {score} is kept and sent for verification.":
    "Rezultati yt prej {score} pikësh ruhet dhe dërgohet për verifikim.",
  "Finish later": "Përfundoje më vonë",
  "Share result": "Ndaj rezultatin",
  "Give up this word?": "Dorëzohesh për këtë fjalë?",
  "The word is shown. It's practice, so nothing is lost.":
    "Fjala shfaqet. Është ushtrim, ndaj s'humbet asgjë.",
  "The word was": "Fjala ishte",
  "Not solved": "Pa zgjidhur",
  "Past puzzles": "Enigmat e kaluara",
  "Missed a day? Play it as practice. Only today's puzzle counts for the leaderboard.":
    "Humbe një ditë? Luaje si ushtrim. Vetëm enigma e sotme llogaritet në renditje.",
  "Past puzzle · {date} · practice": "Enigmë e kaluar · {date} · ushtrim",
  "Past puzzle · practice": "Enigmë e kaluar · ushtrim",
  "Past puzzle: practice, not verified or ranked":
    "Enigmë e kaluar: ushtrim, pa verifikim dhe pa renditje",
  "A past puzzle is practice: it was not verified or saved, and it is not on the leaderboard. Today's puzzle is the one that counts.":
    "Një enigmë e kaluar është ushtrim: nuk u verifikua as u ruajt dhe nuk është në renditje. Llogaritet enigma e sotme.",
  "@{username} scored {score} in {title}. Can you beat it?":
    "@{username} bëri {score} pikë te {title}. A mund ta mundësh?",
  "Start a weekly league": "Nis një ligë javore",
  "Follow a few players and race them every week. It resets on Monday.":
    "Ndiq disa lojtarë dhe garo me ta çdo javë. Rinis të hënën.",
  "This week's league": "Liga e kësaj jave",
  "#{position} of {size} in your league": "#{position} nga {size} në ligën tënde",
  "Play any game to join this week's table.":
    "Luaj cilëndo lojë për t'u futur në tabelën e kësaj jave.",
  "@{username} is {gap} ahead.": "@{username} është {gap} përpara.",
  "You're top. Stay there.": "Je i pari. Qëndro aty.",
  "Resets in {time}": "Rinis pas {time}",
  "Weekly recap": "Përmbledhja javore",
  "A Sunday email about your week: games played, new bests and your streak.":
    "Një email të dielën për javën tënde: lojërat, rekordet e reja dhe seria jote.",
  "Better than {percent}% of today's players.": "Më mirë se {percent}% e lojtarëve të sotëm.",
  "You beat {percent}% of today's {players} players.":
    "Kalove {percent}% të {players} lojtarëve të sotëm.",
  "{done} of {total} done today": "{done} nga {total} të kryera sot",
  "All done. New ones in {time}": "Të gjitha u kryen. Të reja pas {time}",
  "Continue where you left off": "Vazhdo aty ku e le",
  "Saved {when}": "Ruajtur {when}",
  "Continue {title}": "Vazhdo {title}",
  "Swipe for new games": "Rrëshqit për lojëra të reja",
  "{days}. Play one game today to keep it.": "{days}. Luaj një lojë sot për ta mbajtur.",
  "Play any game today to keep it going.": "Luaj cilëndo lojë sot për ta vazhduar.",
  "Today's game is in. Come back tomorrow to add a day.":
    "Loja e sotme u luajt. Kthehu nesër për të shtuar një ditë.",
  "Miss one day and it waits for you. Every 7 days earns a freeze for a longer break.":
    "Nëse humbet një ditë, të pret. Çdo 7 ditë fiton një ngrirje për një pushim më të gjatë.",
  "1 freeze saved: it covers one more missed day.":
    "1 ngrirje e ruajtur: mbulon edhe një ditë të humbur.",
  "{n} freezes saved: they cover {n} more missed days.":
    "{n} ngrirje të ruajtura: mbulojnë edhe {n} ditë të humbura.",
  "Streak reminders": "Kujtesat e serisë",
  "One push at 7pm on a day you haven't played yet, when a streak is on the line":
    "Një njoftim në orën 19:00 në një ditë kur s'ke luajtur ende, kur seria është në rrezik",
  "{days} · play today to keep it": "{days} · luaj sot për ta mbajtur",
  "Keep Unbored close": "Mbaje Unbored pranë",
  "Open it in one tap, and hear when a friend beats your score.":
    "Hape me një prekje dhe merr vesh kur një shok të kalon rezultatin.",
  "Open it in one tap, like any other app.": "Hape me një prekje, si çdo aplikacion tjetër.",
  "Tap Share in Safari's toolbar, then Add to Home Screen.":
    "Prek Ndaj në shiritin e Safarit, pastaj Shto në ekranin bazë.",
  "Add to Home Screen": "Shto në ekranin bazë",
  "Turn on notifications": "Aktivizo njoftimet",
  "Not now": "Jo tani",
  "Notifications are on.": "Njoftimet janë aktive.",
  "Notifications are blocked for Unbored in your browser settings.":
    "Njoftimet për Unbored janë bllokuar në cilësimet e shfletuesit.",
  "Couldn't turn on push notifications.": "Njoftimet nuk u aktivizuan.",
  "{score} points": "{score} pikë",
  "I scored {score} in {title} on Unbored.": "Bëra {score} pikë te {title} në Unbored.",
  "Can you beat me? {url}": "A mund të më mundësh? {url}",
  "Result copied. Paste it anywhere.": "Rezultati u kopjua. Ngjite kudo.",
  "Couldn't copy your result.": "Rezultati nuk u kopjua.",
  "not solved": "pa zgjidhur",
  "Someone scored {score} in {title}. Can you beat it?":
    "Dikush bëri {score} pikë te {title}. A mund ta mundësh?",
  "Finish later and the run is waiting for you next time — or end it now and your score of {score} is kept and sent for verification.":
    "Përfundoje më vonë dhe loja të pret herën tjetër — ose mbylle tani dhe rezultati yt prej {score} pikësh ruhet dhe dërgohet për verifikim.",

  // Don't Touch the Black
  " before one slipped past.": " para se njëra të kalonte.",
  " before the black one.": " para asaj të zezës.",
  "A white tile got past": "Një pllakë e bardhë kaloi",
  "A white tile got past the line.": "Një pllakë e bardhë e kaloi vijën.",
  Black: "E zezë",
  White: "E bardhë",
  "white tile": "pllakë e bardhë",
  "white tiles": "pllaka të bardha",
  "Black tiles: {blackShare}% of this row. Clear every white; never touch black.":
    "Pllaka të zeza: {blackShare}% e këtij rreshti. Pastro çdo të bardhë; mos prek kurrë të zezën.",
  "Don't Touch the Black conveyor. Tap the white tiles in the row at the line.":
    "Shiriti i Mos Prek të Zezën. Prek pllakat e bardha në rreshtin te vija.",
  Row: "Rreshti",
  "Row {n}, lane {n2}, {n3}{n4}": "Rreshti {n}, korsia {n2}, {n3}{n4}",
  "Tap lane {n}": "Prek korsinë {n}",
  "Tap the white tiles in the row at the line.": "Prek pllakat e bardha në rreshtin te vija.",
  Taps: "Prekje",
  "The taps you made are your score if the server agrees.":
    "Prekjet që bëre janë pikët e tua, nëse serveri pajtohet.",
  "You touched the black": "Preke të zezën",
  "You touched the black.": "Preke të zezën.",

  // 8 Puzzle
  ", in place": ", në vend",
  "· par": "· norma",
  "Board {level} — 1 to 8, gap last.": "Tabela {level} — 1 deri në 8, hapësira në fund.",
  "Board {level}, 3 by 3. Arrow keys slide a tile into the gap.":
    "Tabela {level}, 3 me 3. Shigjetat rrëshqasin një pllakë në hapësirë.",
  "Board {n} solved, +{points}. Board {level} is scrambled a little more.":
    "Tabela {n} u zgjidh, +{points}. Tabela {level} është pak më e përzier.",
  "Boards solved": "Tabela të zgjidhura",
  "Every board is fully scrambled from here.": "Nga këtu çdo tabelë është plotësisht e përzier.",
  "Hint: slide this tile.": "Ndihmë: rrëshqit këtë pllakë.",
  move: "lëvizje",
  moves: "lëvizje",
  "Solving this board adds {formatClockGain}. Arrow keys slide too.":
    "Zgjidhja e kësaj tabele shton {formatClockGain}. Edhe shigjetat rrëshqasin.",

  // The feed and cards
  "As soon as games are published they show up in this feed.":
    "Sapo lojërat publikohen, shfaqen në këtë rrjedhë.",
  "Couldn't load the feed": "Rrjedha nuk mund të ngarkohej",
  Feed: "Rrjedha",
  "For You": "Për ty",
  "Nothing here yet": "Ende asgjë këtu",
  Details: "Detaje",
  Leaderboard: "Renditja",
  Like: "Pëlqej",
  "Loading feed": "Po ngarkohet rrjedha",
  "Not playable yet": "Ende jo e luajtshme",
  "Play {title}": "Luaj {title}",
  Rules: "Rregullat",
  Save: "Ruaj",
  Share: "Ndaj",
  "Something went wrong.": "Diçka shkoi keq.",
  "Tap to play": "Prek për të luajtur",
  "View {title}": "Shiko {title}",
  "Daily challenge": "Sfida e ditës",
  Daily: "Ditore",
  Playable: "E luajtshme",
  "Check back soon — new games are added every week.":
    "Kthehu së shpejti — lojëra të reja shtohen çdo javë.",
  "Couldn't load games": "Lojërat nuk mund të ngarkoheshin",
  "Load more": "Ngarko më shumë",
  "Loading…": "Po ngarkohet…",

  // Gridburst
  "Bigger pieces turn up more often the longer you last.":
    "Sa më gjatë të qëndrosh, aq më shpesh vijnë copa më të mëdha.",
  "Board — {length} pieces placed": "Tabela — {length} copa të vendosura",
  "Combo ×{combo}": "Kombinim ×{combo}",
  "Combo ×{combo} — burst again within {n} {n2} to keep it.":
    "Kombinim ×{combo} — shpërthe sërish brenda {n} {n2} për ta mbajtur.",
  "Drag a piece onto the grid. Fill a row or column to burst it.":
    "Tërhiq një copë në rrjetë. Mbush një rresht ose kolonë për ta shpërthyer.",
  empty: "bosh",
  filled: "e mbushur",
  "Gridburst board. Press 1, 2 or 3 to pick a piece, the arrow keys to move it and Enter to place it.":
    "Tabela e Gridburst. Shtyp 1, 2 ose 3 për të zgjedhur një copë, shigjetat për ta lëvizur dhe Enter për ta vendosur.",
  line: "vijë",
  lines: "vija",
  Lines: "Vija",
  "Nothing fits": "Asgjë nuk përshtatet",
  "Nothing in your tray fits.": "Asgjë nga copat e tua nuk përshtatet.",
  piece: "copë",
  pieces: "copa",
  "Piece {n}, {length} squares{n2}{n3}": "Copa {n}, {length} katrorë{n2}{n3}",
  "Slot {n}, placed": "Vendi {n}, e vendosur",
  "Tap a square for the piece's top-left corner.":
    "Prek një katror për këndin e sipërm majtas të copës.",
  "The pieces you placed are your score if the server agrees.":
    "Copat që vendose janë pikët e tua, nëse serveri pajtohet.",
  "Verified by replaying your placements on the server, then saved to the leaderboard.":
    "U verifikua duke riluajtur vendosjet e tua në server, pastaj u ruajt në renditje.",
  "Verified by replaying your placements on the server. This was a guest run, so it is not on the leaderboard.":
    "U verifikua duke riluajtur vendosjet e tua në server. Kjo ishte lojë si mysafir, ndaj nuk është në renditje.",
  "Your pieces": "Copat e tua",

  // Hints and rules sheets
  Hint: "Ndihmë",
  "Hint:": "Ndihmë:",
  "Next hint in {waitSeconds}s": "Ndihma tjetër pas {waitSeconds}s",
  "How to play {title}": "Si luhet {title}",
  "The rules for this game are not written yet.": "Rregullat e kësaj loje ende nuk janë shkruar.",
  "The rules, before you start.": "Rregullat, para se të nisësh.",

  // Huedini
  "{n} block, {w} by {h}, row {n2}, column {n3}. {n4}":
    "Blloku {n}, {w} me {h}, rreshti {n2}, kolona {n3}. {n4}",
  "{n} gate on the {n2} edge": "Porta {n} në anën {n2}",
  "{tier} boards from here.": "Tabela {tier} nga këtu.",
  "Board {level}, {side} by {side2}, {length} blocks. Drag a block, or focus it and use the arrow keys.":
    "Tabela {level}, {side} me {side2}, {length} blloqe. Tërhiq një bllok, ose zgjidhe dhe përdor shigjetat.",
  "Board {n} cleared. Here comes the next one.": "Tabela {n} u pastrua. Po vjen tjetra.",
  "Boards cleared": "Tabela të pastruara",
  "Clearing this board scores {dealt} and adds {formatClockGain}.":
    "Pastrimi i kësaj tabele jep {dealt} pikë dhe shton {formatClockGain}.",
  "Drag each block out through the gate of its colour.":
    "Nxirr çdo bllok nga porta e ngjyrës së vet.",
  "The moves you made are your score if the server agrees.":
    "Lëvizjet që bëre janë pikët e tua, nëse serveri pajtohet.",
  "Verified by replaying your moves on the server, then saved to the leaderboard.":
    "U verifikua duke riluajtur lëvizjet e tua në server, pastaj u ruajt në renditje.",
  "Verified by replaying your moves on the server. This was a guest run, so it is not on the leaderboard.":
    "U verifikua duke riluajtur lëvizjet e tua në server. Kjo ishte lojë si mysafir, ndaj nuk është në renditje.",

  // Leaderboards
  "{games} games": "{games} lojëra",
  "1 game": "1 lojë",
  "A former player": "Një ish-lojtar",
  "A player is ranked once they have verified scores in {minGames} different games.":
    "Një lojtar hyn në renditje kur ka rezultate të verifikuara në {minGames} lojëra të ndryshme.",
  "A score appears here once a run has been verified and saved. Nothing is ranked until then.":
    "Një rezultat shfaqet këtu pasi loja të jetë verifikuar dhe ruajtur. Deri atëherë asgjë nuk renditet.",
  "Couldn't load the leaderboard": "Renditja nuk mund të ngarkohej",
  "Find people": "Gjej njerëz",
  "Follow players from their profiles or from search, and their best scores show up here.":
    "Ndiq lojtarë nga profilet e tyre ose nga kërkimi, dhe rezultatet e tyre më të mira shfaqen këtu.",
  "games (": "lojëra (",
  "Log in": "Hyr",
  "No game selected": "Asnjë lojë e zgjedhur",
  "No one is ranked in this window": "Askush nuk është në renditje në këtë periudhë",
  "No one is ranked yet": "Ende askush në renditje",
  "No scores in this window": "Asnjë rezultat në këtë periudhë",
  "No scores yet": "Ende asnjë rezultat",
  "Nobody you follow is on this board yet. Their best runs show up here once they're verified.":
    "Askush që ndjek nuk është ende në këtë renditje. Lojërat e tyre më të mira shfaqen këtu pasi të verifikohen.",
  "Nobody you follow is ranked yet": "Askush që ndjek nuk është ende në renditje",
  "Play {gamesLeft} more games": "Luaj edhe {gamesLeft} lojëra",
  "Play 1 more game": "Luaj edhe 1 lojë",
  "points).": "pikë).",
  "Scores belong to a game, so pick one to see its board.":
    "Rezultatet i përkasin një loje, ndaj zgjidh një për të parë renditjen e saj.",
  "See how the people you follow did": "Shiko si ia dolën ata që ndjek",
  "Sign in, follow a few players, and their ratings show up here next to yours.":
    "Identifikohu, ndiq disa lojtarë, dhe vlerësimet e tyre shfaqen këtu pranë tëndit.",
  "Sign in, follow a few players, and their scores show up here next to yours.":
    "Identifikohu, ndiq disa lojtarë, dhe rezultatet e tyre shfaqen këtu pranë tëndit.",
  "to get on the board.": "për të hyrë në renditje.",
  "View @{username}'s profile": "Shiko profilin e @{username}",
  "View your profile": "Shiko profilin tënd",
  You: "Ti",
  "You're not following anyone yet": "Ende nuk ndjek askënd",
  "You're rated in": "Je i vlerësuar në",
  "Your best score in each game becomes a percentile of everyone who played it, up to 100 per game. Your rating adds them up. Play {minGames} games to get ranked.":
    "Rezultati yt më i mirë në çdo lojë bëhet përqindësh i të gjithë atyre që e luajtën, deri në 100 për lojë. Vlerësimi yt i mbledh. Luaj {minGames} lojëra për të hyrë në renditje.",
  "{title} leaderboard": "Renditja e {title}",
  "All game": "Të gjitha lojërat",
  "All games": "Të gjitha lojërat",
  "All games leaderboard": "Renditja e të gjitha lojërave",
  "All time": "Gjithë kohës",
  Global: "Globale",
  "The catalogue is unavailable, so the game list is empty.":
    "Katalogu nuk është i disponueshëm, ndaj lista e lojërave është bosh.",
  "This week": "Këtë javë",
  "Time period": "Periudha",
  Today: "Sot",
  "Verified scores only.": "Vetëm rezultate të verifikuara.",
  "Next: {next}": "Tjetra: {next}",

  // Memory Flash
  "board · flash": "tabela · ndriçimi",
  cell: "kuti",
  cells: "kuti",
  "Cell {n}": "Kutia {n}",
  "Pattern broken": "Modeli u prish",
  "Pattern broken.": "Modeli u prish.",
  "Pattern grid, {side} by {side2}": "Rrjeta e modelit, {side} me {side2}",
  "Rebuild each pattern in any order. A wrong cell ends the run. 100 points a round, with no final pattern.":
    "Rindërto çdo model në çfarëdo radhe. Një kuti e gabuar e mbyll lojën. 100 pikë për raund, pa model të fundit.",
  "The board grows to {side}×{side2}.": "Tabela rritet në {side}×{side2}.",
  "The cells entered so far are your score if the server agrees.":
    "Kutitë e plotësuara deri tani janë pikët e tua, nëse serveri pajtohet.",
  "Watch the pattern — {round} {n} lit.": "Shiko modelin — {round} {n} të ndezura.",
  "Your turn — {remaining} more {n} in this pattern.":
    "Radha jote — edhe {remaining} {n} në këtë model.",

  // Sudoku and Mini Sudoku
  " and {open} {n} still empty": " dhe {open} {n} ende bosh",
  ", notes {join}": ", shënime {join}",
  "…and {n} more, marked in red above.": "…dhe {n} të tjera, të shënuara me të kuqe më lart.",
  "{cell}: a {placed} fit for the moment, but the board's only solution has a {answer} there, so the {placed2} would have blocked it later.":
    "{cell}: një {placed} përshtatej për momentin, por zgjidhja e vetme e tabelës ka {answer} aty, ndaj {placed2} do ta kishte bllokuar më vonë.",
  "{cell}: your {placed} repeats the {placed2} already in that {clash}. It needed a {answer}.":
    "{cell}: {placed} jote përsërit {placed2} që është tashmë në atë {clash}. Duhej {answer}.",
  "{length} wrong {n}{empties}. A wrong digit doesn't end the run, but it hides the right answer and costs you time.":
    "{length} {n} gabim{empties}. Një shifër e gabuar nuk e mbyll lojën, por fsheh përgjigjen e saktë dhe të kushton kohë.",
  "Board {level} checked against its solution. {summary} {join}":
    "Tabela {level} u krahasua me zgjidhjen e saj. {summary} {join}",
  "Board {level}, {level2} — 1 to 6 in every row, column and box.":
    "Tabela {level}, {level2} — 1 deri në 6 në çdo rresht, kolonë dhe kuti.",
  "Board {level}, {level2} — 1 to 9 in every row, column and box.":
    "Tabela {level}, {level2} — 1 deri në 9 në çdo rresht, kolonë dhe kuti.",
  "Board {level}, {MINI_SUDOKU_SIDE} by {MINI_SUDOKU_SIDE2}":
    "Tabela {level}, {MINI_SUDOKU_SIDE} me {MINI_SUDOKU_SIDE2}",
  "Board {level}, {SUDOKU_SIDE} by {SUDOKU_SIDE2}":
    "Tabela {level}, {SUDOKU_SIDE} me {SUDOKU_SIDE2}",
  "Board {level}, checked": "Tabela {level}, e kontrolluar",
  "Board {n} solved, +{MINI_SUDOKU_POINTS_PER_BOARD}. Board {level} is {level2}.":
    "Tabela {n} u zgjidh, +{MINI_SUDOKU_POINTS_PER_BOARD}. Tabela {level} është {level2}.",
  "Board {n} solved, +{SUDOKU_POINTS_PER_BOARD}. Board {level} is {level2}.":
    "Tabela {n} u zgjidh, +{SUDOKU_POINTS_PER_BOARD}. Tabela {level} është {level2}.",
  digit: "shifër",
  digits: "shifra",
  Erase: "Fshi",
  "Everything you placed was right.": "Gjithçka që vendose ishte e saktë.",
  "Faint: not filled in": "E zbehtë: e paplotësuar",
  "From here, boards need more than singles: pencil notes help.":
    "Nga këtu, tabelat duan më shumë se zgjidhje të vetme: shënimet me laps ndihmojnë.",
  "From here, look along rows and columns too, not just boxes.":
    "Nga këtu, shiko edhe rreshtat dhe kolonat, jo vetëm kutitë.",
  "Hard boards from here: fewer clues, and more pairs to find.":
    "Tabela të vështira nga këtu: më pak ndihma dhe më shumë çifte për të gjetur.",
  "No mistakes: {open} {n} still empty when the run ended. Here is the rest of the board.":
    "Asnjë gabim: {open} {n} ende bosh kur mbaroi loja. Ja pjesa tjetër e tabelës.",
  Note: "Shënim",
  "Note {digit}": "Shënim {digit}",
  Notes: "Shënimet",
  "Notes on": "Shënimet aktive",
  Numbers: "Numrat",
  "Place {digit}, {left} left": "Vendos {digit}, mbeten {left}",
  "Row {n} column {n2}, {n3}{n4}{n5}{notesText}":
    "Rreshti {n}, kolona {n2}, {n3}{n4}{n5}{notesText}",
  "Row {n}, column {n2}": "Rreshti {n}, kolona {n2}",
  "Something clashes: a red digit repeats in its row, column or box.":
    "Diçka përplaset: një shifër e kuqe përsëritet në rreshtin, kolonën ose kutinë e saj.",
  square: "katror",
  squares: "katrorë",
  "square was": "katror ishte",
  "squares were": "katrorë ishin",
  "Where board {level} went wrong": "Ku gaboi tabela {level}",
  "Wrong (yours struck through)": "Gabim (e jotja e vijëzuar)",
  "Your last board": "Tabela jote e fundit",
  "Yours, right": "E jotja, e saktë",

  // One Move
  "A move flips a cross. Find the one that restores the pattern. 100 points a board, with no final board.":
    "Një lëvizje kthen një kryq. Gjej atë që e rikthen modelin. 100 pikë për tabelë, pa tabelë të fundit.",
  "board ·": "tabela ·",
  "Board {level} — one move restores the checkerboard.":
    "Tabela {level} — një lëvizje e rikthen shahun.",
  "Board {level}, {size} by {size2}": "Tabela {level}, {size} me {size2}",
  "Boards are {nextSide}×{nextSide2} from here.": "Nga këtu tabelat janë {nextSide}×{nextSide2}.",
  "Boards restored": "Tabela të rikthyera",
  dark: "e errët",
  light: "e çelët",
  "Hint: tap here.": "Ndihmë: prek këtu.",
  "Hint: the move is in this row.": "Ndihmë: lëvizja është në këtë rresht.",
  "One move missed": "Lëvizja u humb",
  "One move missed.": "Lëvizja u humb.",
  "Row {n} column {n2}": "Rreshti {n}, kolona {n2}",

  // Crowns
  "{mistakesLeft} of {QUEENS_MISTAKES} mistakes left":
    "Mbeten {mistakesLeft} nga {QUEENS_MISTAKES} gabime",
  "Board {level} — one crown per row, column and colour.":
    "Tabela {level} — një kurorë për rresht, kolonë dhe ngjyrë.",
  "Board {n} solved, +{points}. Board {level} is {level2}×{level3}.":
    "Tabela {n} u zgjidh, +{points}. Tabela {level} është {level2}×{level3}.",
  "clear it": "pastroje",
  "empty, ruled out by a crown": "bosh, e përjashtuar nga një kurorë",
  "Faint Xs mark cells your crowns already rule out.":
    "X-të e zbehta shënojnë kutitë që kurorat e tua i përjashtojnë tashmë.",
  "Hint: a crown goes here.": "Ndihmë: këtu shkon një kurorë.",
  "Hint: no crown goes here.": "Ndihmë: këtu nuk shkon kurorë.",
  "mark an X": "shëno një X",
  "marked X": "e shënuar X",
  mistake: "gabim",
  mistakes: "gabime",
  "No crown goes there. {left} {n} left.": "Aty nuk shkon kurorë. Mbeten {left} {n}.",
  "Out of mistakes": "Mbaruan gabimet",
  "place a crown": "vendos një kurorë",
  "ruled out by a mistake": "e përjashtuar nga një gabim",
  "Three mistakes. The run is over.": "Tre gabime. Loja mbaroi.",
  "Play again": "Luaj sërish",
  "Sign in to rank your scores": "Identifikohu për t'i futur rezultatet në renditje",
  "Guest runs aren't ranked": "Lojërat si mysafir nuk renditen",
  "Make a free account and your next score goes on the leaderboard, with a streak to keep.":
    "Krijo një llogari falas dhe rezultati yt i radhës del në renditje, me një seri ditësh për ta mbajtur.",
  "Create a free account": "Krijo një llogari falas",

  // Saved runs
  "Continue run": "Vazhdo lojën",
  "Left at": "Lënë te",
  "New run": "Lojë e re",
  "Pick up where you left off?": "Të vazhdosh aty ku e le?",
  "Score so far": "Pikët deri tani",
  "Starting a new run ends this one and keeps its score of {score}.":
    "Nisja e një loje të re e mbyll këtë dhe ruan rezultatin e saj prej {score} pikësh.",
  "You have an unfinished run of {title}, saved to your account.":
    "Ke një lojë të papërfunduar të {title}, të ruajtur në llogarinë tënde.",

  // Fusebox
  "{charged} charged cells": "{charged} kuti të ngarkuara",
  "{n} sparks left": "{n} shkëndija të mbetura",
  "{pops} pops: 1 spark back.": "{pops} shpërthime: 1 shkëndijë kthehet.",
  "{pops} pops: {refund} sparks back.": "{pops} shpërthime: {refund} shkëndija kthehen.",
  "{pops} pops. Longer chains pay sparks back.":
    "{pops} shpërthime. Zinxhirët më të gjatë kthejnë shkëndija.",
  "{tilesPlaced} {n} popped, {clearedColumns} {n2} cleared.":
    "{tilesPlaced} {n} të shpërthyera, {clearedColumns} {n2} të pastruara.",
  "1 pop. Chains pay sparks back.": "1 shpërthim. Zinxhirët kthejnë shkëndija.",
  "1 spark left": "1 shkëndijë e mbetur",
  "Biggest chain": "Zinxhiri më i madh",
  "Board {level}, {charged} charged cells.": "Tabela {level}, {charged} kuti të ngarkuara.",
  "Board {n} cleared: +{FUSEBOX_CLEAR_SPARKS} sparks.":
    "Tabela {n} u pastrua: +{FUSEBOX_CLEAR_SPARKS} shkëndija.",
  "Charged. Line up a chain.": "U ngarkua. Përgatit një zinxhir.",
  "Last spark. Make it count.": "Shkëndija e fundit. Përdore mirë.",
  "One tap could have saved this run": "Një prekje mund ta kishte shpëtuar këtë lojë",
  "Out of sparks": "Pa shkëndija",
  "Out of sparks. The run is over.": "Mbaruan shkëndijat. Loja mbaroi.",
  "Row {n}, column {n2}: charge {charge}.": "Rreshti {n}, kolona {n2}: ngarkesa {charge}.",
  "Row {n}, column {n2}: shielded cell, charge {charge}.":
    "Rreshti {n}, kolona {n2}: kuti e mbrojtur, ngarkesa {charge}.",
  "Row {n}, column {n2}: surge cell, charge {charge}.":
    "Rreshti {n}, kolona {n2}: kuti e fuqishme, ngarkesa {charge}.",
  "Row {row}, column {column} would have popped 1 cell for +{gain}.":
    "Rreshti {row}, kolona {column} do të shpërthente 1 kuti për +{gain}.",
  "Row {row}, column {column} would have popped {pops} cells for +{gain}.":
    "Rreshti {row}, kolona {column} do të shpërthente {pops} kuti për +{gain}.",
  "Shielded cells appear: the first hit only breaks the shield.":
    "Shfaqen kutitë e mbrojtura: goditja e parë vetëm thyen mburojën.",
  "Sparks back: {one} pops +1 · {two} pops +2 · {three} pops +3":
    "Shkëndija kthehen: {one} shpërthime +1 · {two} shpërthime +2 · {three} shpërthime +3",
  "Surge cells appear: they fire diagonally too.":
    "Shfaqen kutitë e fuqishme: lëshojnë rrufe edhe diagonalisht.",
  "Tap a cell to add charge. At {n} it pops.":
    "Prek një kuti për të shtuar ngarkesë. Me {n} ajo shpërthen.",
  "The missed tap: row {row}, column {column}.": "Prekja e humbur: rreshti {row}, kolona {column}.",
  "Wave {n}": "Vala {n}",

  // Minefield
  "{left} mines left": "{left} mina të mbetura",
  "{n} lives left": "{n} jetë të mbetura",
  "{tilesPlaced} {n} opened, {clearedColumns} {n2} cleared.":
    "{tilesPlaced} {n} të hapura, {clearedColumns} {n2} të pastruara.",
  "1 life left": "1 jetë e mbetur",
  "A mine! Last life.": "Një minë! Jeta e fundit.",
  "A mine! {n} lives left.": "Një minë! {n} jetë të mbetura.",
  "Board {level}, {side} by {side2}, {left} mines left.":
    "Tabela {level}, {side} me {side2}, {left} mina të mbetura.",
  "Board {n} cleared.": "Tabela {n} u pastrua.",
  "Board {n} cleared. A life comes back.": "Tabela {n} u pastrua. Një jetë kthehet.",
  "Clean boards": "Tabela pa minë",
  Flag: "Flamur",
  "Flag mode: tap a cell you think hides a mine.":
    "Mënyra e flamurit: prek një kuti që mendon se fsheh një minë.",
  "Flag removed.": "Flamuri u hoq.",
  "Flagged.": "U shënua me flamur.",
  "Out of lives": "Pa jetë",
  "Out of lives. The run is over.": "Mbaruan jetët. Loja mbaroi.",
  "Read the numbers. Flag what you are sure of.":
    "Lexo numrat. Shëno me flamur atë që e di me siguri.",
  Reveal: "Zbulo",
  "Row {n}, column {n2}: {count} mines nearby.": "Rreshti {n}, kolona {n2}: {count} mina afër.",
  "Row {n}, column {n2}: 1 mine nearby.": "Rreshti {n}, kolona {n2}: 1 minë afër.",
  "Row {n}, column {n2}: closed.": "Rreshti {n}, kolona {n2}: e mbyllur.",
  "Row {n}, column {n2}: flagged.": "Rreshti {n}, kolona {n2}: me flamur.",
  "Row {n}, column {n2}: mine.": "Rreshti {n}, kolona {n2}: minë.",
  "Row {n}, column {n2}: no mines nearby.": "Rreshti {n}, kolona {n2}: asnjë minë afër.",
  "Tap any cell. The first one is always safe.":
    "Prek çfarëdo kutie. E para është gjithmonë e sigurt.",
  "Tap mode": "Mënyra e prekjes",
  "The board you ended on, with its mines shown.": "Tabela ku mbarove, me minat e saj të shfaqura.",

  // The speed bonus, and Crowns' free undo
  "+{bonus} speed": "+{bonus} shpejtësi",
  "Clear board": "Pastro tabelën",
  "crown, clashing with another crown": "kurorë, në konflikt me një kurorë tjetër",
  "Hint: this crown comes off.": "Ndihmë: kjo kurorë duhet hequr.",
  "par {time}": "normale {time}",
  "Speed bonus": "Bonus shpejtësie",
  "Those crowns clash. Tap one to clear it, or use Undo.":
    "Këto kurora janë në konflikt. Prek njërën për ta hequr, ose përdor Zhbëj.",
  "Undo is free. Beat par for a speed bonus.":
    "Zhbërja është falas. Mund kohën normale për një bonus shpejtësie.",

  // Scatter
  "{jams} of {SCATTER_MAX_JAMS} jams": "{jams} nga {SCATTER_MAX_JAMS} bllokime",
  "Board {level}, {side} by {side2}, {tiles} tiles.":
    "Tabela {level}, {side} me {side2}, {tiles} pllaka.",
  "Board {n} cleared, +{SCATTER_CLEAR_BONUS}.": "Tabela {n} u pastrua, +{SCATTER_CLEAR_BONUS}.",
  "Boards are {side}×{side2} from here.": "Nga këtu tabelat janë {side}×{side2}.",
  "Clearing the board adds {SCATTER_CLEAR_BONUS}.":
    "Pastrimi i tabelës shton {SCATTER_CLEAR_BONUS}.",
  "Jammed — something is in the way. {n} left.": "U bllokua — diçka është në rrugë. Mbeten {n}.",
  "No tile could leave, so that board is lost. {n} jams left.":
    "Asnjë pllakë nuk mund të dilte, ndaj ajo tabelë humbi. Mbeten {n} bllokime.",
  "Out of jams": "Mbaruan bllokimet",
  "Row {n}, column {n2}: {n3}tile pointing {n4}{n5}.":
    "Rreshti {n}, kolona {n2}: {n3}pllakë që tregon {n4}{n5}.",
  "Tap a tile with a clear lane to send it off the board.":
    "Prek një pllakë me rrugë të lirë për ta nxjerrë nga tabela.",
  "Three jams. The run is over.": "Tre bllokime. Loja mbaroi.",
  tile: "pllakë",
  tiles: "pllaka",

  // 7 Second
  "· right answers add 1.5s · wrong answers cost 2s":
    "· përgjigjet e sakta shtojnë 1.5s · të gabuarat kushtojnë 2s",
  "{correct} correct of {length} answered": "{correct} të sakta nga {length} të përgjigjura",
  "7 Second table": "Tabela e 7 Sekondave",
  "Answer {option}": "Përgjigju {option}",
  Answers: "Përgjigje",
  "Checking your run…": "Po kontrollohet loja jote…",
  "Clock remaining": "Koha e mbetur",
  Correct: "Saktë",
  "Correct — 1.5 seconds back.": "Saktë — 1.5 sekonda mbrapsht.",
  "Guest run: verified, but not ranked — practise as often as you like":
    "Lojë si mysafir: e verifikuar, por jo në renditje — ushtrohu sa herë të duash",
  "Offline practice: not verified or ranked — practise as often as you like":
    "Ushtrim pa internet: as i verifikuar, as në renditje — ushtrohu sa herë të duash",
  "One ranked run a day keeps the daily board a comparison of the same deck. The next one arrives at midnight, your time.":
    "Një lojë në renditje në ditë e mban renditjen ditore një krahasim të së njëjtës pako. Tjetra vjen në mesnatë, sipas orës sate.",
  "Pick the right answer.": "Zgjidh përgjigjen e saktë.",
  Press: "Shtyp",
  "Signed in: this is today's ranked attempt":
    "I identifikuar: kjo është përpjekja jote e sotme në renditje",
  "Sixty answers — the deck is done": "Gjashtëdhjetë përgjigje — pakoja mbaroi",
  "The next daily deck arrives at midnight, your time.":
    "Pakoja e radhës ditore vjen në mesnatë, sipas orës sate.",
  "The score is the server's replay, not the number on this screen.":
    "Rezultati është riluajtja e serverit, jo numri në këtë ekran.",
  "Time remaining": "Koha e mbetur",
  "Today's attempt is done": "Përpjekja e sotme mbaroi",
  "Verified by replaying your answers on the server, then saved to the leaderboard. That was today's ranked attempt.":
    "U verifikua duke riluajtur përgjigjet e tua në server, pastaj u ruajt në renditje. Kjo ishte përpjekja jote e sotme në renditje.",
  "Verified by replaying your answers on the server. This was a guest run, so it is not on the leaderboard.":
    "U verifikua duke riluajtur përgjigjet e tua në server. Kjo ishte lojë si mysafir, ndaj nuk është në renditje.",
  "Wrong — 2 seconds gone.": "Gabim — 2 sekonda humbën.",

  // Stack 10
  "Add up to exactly ten to clear a column. Past ten ends the run. There is no final tile.":
    "Mblidh saktësisht dhjetë për të pastruar një kolonë. Mbi dhjetë e mbyll lojën. Nuk ka pllakë të fundit.",
  "Columns cleared": "Kolona të pastruara",
  "Heavier tile chance {pressurePercent}% · up to +{heavyBonus}":
    "Mundësia e pllakës më të rëndë {pressurePercent}% · deri në +{heavyBonus}",
  "Heavier tiles can start arriving now": "Pllakat më të rënda mund të nisin të vijnë tani",
  "Next tile": "Pllaka e radhës",
  "Tile {n}": "Pllaka {n}",
  "Warm-up: heavier tiles start after tile {STACK10_TILES}":
    "Ngrohje: pllakat më të rënda nisin pas pllakës {STACK10_TILES}",

  // Sun & Moon
  ", breaks a rule": ", shkel një rregull",
  ", fixed": ", e fiksuar",
  "Board {level} — three suns and three moons in every line.":
    "Tabela {level} — tre diej dhe tre hëna në çdo vijë.",
  "Board {level} · {level2} cells to start · clock +{n}":
    "Tabela {level} · {level2} kuti në fillim · ora +{n}",
  "Board {level}, {TANGO_SIDE} by {TANGO_SIDE2}": "Tabela {level}, {TANGO_SIDE} me {TANGO_SIDE2}",
  "Board {n} solved, +{points}. Board {level} starts with {level2} cells.":
    "Tabela {n} u zgjidh, +{points}. Tabela {level} nis me {level2} kuti.",
  "Boards start with three cells from here.": "Nga këtu tabelat nisin me tre kuti.",
  "make it a moon": "bëje hënë",
  moon: "hënë",
  "place a sun": "vendos një diell",
  sun: "diell",
  "Something clashes: the red cells break a rule.":
    "Diçka përplaset: kutitë e kuqe shkelin një rregull.",
  "Tap for a sun, again for a moon. Solving this board adds {formatClockGain}.":
    "Prek për diell, sërish për hënë. Zgjidhja e kësaj tabele shton {formatClockGain}.",
  "this is": "kjo është",
  "this should be": "kjo duhet të jetë",

  // Flutter
  Flaps: "Përplasje krahësh",
  "Flight time": "Koha e fluturimit",
  "Flutter field. Tap, click or press Space to flap.":
    "Fusha e Fluturo. Prek, kliko ose shtyp Space për të përplasur krahët.",
  gap: "hapësirë",
  gaps: "hapësira",
  "Tap to flap": "Prek për të përplasur krahët",
  "Tap, click or press Space to flap. Thread the gaps; don't touch the columns or the ground.":
    "Prek, kliko ose shtyp Space për të përplasur krahët. Kalo nëpër hapësira; mos prek kolonat ose tokën.",
  "Verified by replaying your flight on the server, then saved to the leaderboard.":
    "U verifikua duke riluajtur fluturimin tënd në server, pastaj u ruajt në renditje.",
  "Verified by replaying your flight on the server. This was a guest run, so it is not on the leaderboard.":
    "U verifikua duke riluajtur fluturimin tënd në server. Kjo ishte lojë si mysafir, ndaj nuk është në renditje.",
  "You hit the wall": "U përplase",

  // Your stats
  Best: "Më i miri",
  "Last played {lastPlayedAt}": "Luajtur për herë të fundit më {lastPlayedAt}",
  "No runs yet. Your scores and stats, and any run you leave unfinished, are kept on your account.":
    "Ende asnjë lojë. Rezultatet, statistikat dhe çdo lojë që lë përgjysmë ruhen në llogarinë tënde.",
  Runs: "Lojëra",
  "to keep your scores, your stats and any run you leave unfinished.":
    "për të ruajtur rezultatet, statistikat dhe çdo lojë që lë përgjysmë.",
  "Total points": "Pikët gjithsej",
  "Your stats": "Statistikat e tua",

  // Trail
  "Board {level} — start on 1.": "Tabela {level} — nis te 1.",
  "Board {n} solved, +{points}. Start on 1.": "Tabela {n} u zgjidh, +{points}. Nis te 1.",
  "Every cell, 1 to {last} in order.": "Çdo kuti, nga 1 deri në {last} me radhë.",
  "Hint: go back to here.": "Ndihmë: kthehu deri këtu.",
  "Hint: go here next.": "Ndihmë: shko këtu më pas.",
  "on the path": "në shteg",
  "The path you drew is your score if the server agrees.":
    "Shtegu që vizatove janë pikët e tua, nëse serveri pajtohet.",
  "Verified by replaying your path on the server, then saved to the leaderboard.":
    "U verifikua duke riluajtur shtegun tënd në server, pastaj u ruajt në renditje.",
  "Verified by replaying your path on the server. This was a guest run, so it is not on the leaderboard.":
    "U verifikua duke riluajtur shtegun tënd në server. Kjo ishte lojë si mysafir, ndaj nuk është në renditje.",

  // Following feed, offline play and streaks
  "Couldn't load more games.": "Nuk mund të ngarkoheshin më shumë lojëra.",
  "Couldn't load the following feed.": "Rrjedha e të ndjekurve nuk mund të ngarkohej.",
  "Sign in to view your following feed.": "Identifikohu për të parë rrjedhën e të ndjekurve.",
  "You played this offline, so it was a practice run: it was not verified or saved, and it is not on the leaderboard.":
    "E luajte pa internet, ndaj ishte ushtrim: nuk u verifikua, nuk u ruajt dhe nuk është në renditje.",
  "{days}, on a rest day. You missed yesterday, so play today to save it.":
    "{days}, në një ditë pushimi. Dje nuk luajte, ndaj luaj sot për ta shpëtuar.",
  "{streak}-day streak": "{streak} ditë rresht",
  "1-day streak": "1 ditë rresht",
  // Sumdoku
  "Board {level}, {SUMDOKU_SIDE} by {SUMDOKU_SIDE2}":
    "Tabela {level}, {SUMDOKU_SIDE} me {SUMDOKU_SIDE2}",
  "Board {n} solved, +{SUMDOKU_POINTS_PER_BOARD}. Board {level} is {level2}.":
    "Tabela {n} u zgjidh, +{SUMDOKU_POINTS_PER_BOARD}. Tabela {level} është {level2}.",
  "Fewer digits given from here: let the cage totals do the work.":
    "Nga këtu jepen më pak shifra: lëri totalet e kafazeve të bëjnë punën.",
  "No digits given from here: only the sums. A cage of two adding to 3 can only be 1 and 2.":
    "Nga këtu nuk jepet asnjë shifër: vetëm shumat. Një kafaz me dy kuti që bën 3 mund të jetë vetëm 1 dhe 2.",
  "Hard boards from here: bigger cages. Pencil notes help.":
    "Tabela të vështira nga këtu: kafaze më të mëdha. Shënimet ndihmojnë.",
  "Something's off: a red digit repeats, or a red cage misses its total.":
    "Diçka nuk shkon: një shifër e kuqe përsëritet, ose një kafaz i kuq nuk e arrin totalin.",
  "This cell's cage is just itself: it's a {total}.":
    "Kafazi i kësaj kutie është vetëm ajo: është {total}.",
  "This cage: {size} cells adding to {total}. {sum} so far.":
    "Ky kafaz: {size} kuti që bëjnë {total}. Deri tani {sum}.",
  "This cage: {size} cells adding to {total}, no repeats.":
    "Ky kafaz: {size} kuti që bëjnë {total}, pa përsëritje.",
  ", cage of {size} adding to {total}": ", kafaz me {size} që bën {total}",
  // Guesswork (Gjeje)
  "Couldn't start today's word": "Fjala e ditës nuk u nis",
  Elsewhere: "Diku tjetër",
  Enter: "Dërgo",
  "Fetching today's word…": "Po merret fjala e ditës…",
  "Five letters, please.": "Pesë shkronja, të lutem.",
  "Give up today's word?": "Dorëzohesh për fjalën e sotme?",
  "Guess {n} of {max}": "Përpjekja {n} nga {max}",
  "Guess {n}: {letters}": "Përpjekja {n}: {letters}",
  Guesses: "Përpjekjet",
  "Keep guessing": "Vazhdo të provosh",
  "Not in it": "Nuk është",
  "Play today's word": "Luaj fjalën e ditës",
  Points: "Pikë",
  "Right place": "Vendi i duhur",
  "Signed in: one ranked play a day": "I identifikuar: një lojë e renditur në ditë",
  "Solved in {n} of {max}": "U gjet në {n} nga {max}",
  "The next word arrives in {n}{minutes} min.": "Fjala tjetër vjen pas {n}{minutes} min.",
  "The word is shown and the run scores nothing. There is one play a day.":
    "Fjala shfaqet dhe loja nuk fiton pikë. Ka një lojë në ditë.",
  "The word: {word}": "Fjala: {word}",
  "Today's word was": "Fjala e sotme ishte",
  "Type a five-letter word, then Enter.": "Shkruaj një fjalë me pesë shkronja, pastaj Dërgo.",
  "Verified by replaying your guesses on the server, then saved to the leaderboard.":
    "U verifikua duke riluajtur përpjekjet në server, pastaj u ruajt në renditje.",
  "Verified by replaying your guesses on the server. This was a guest run, so it is not on the leaderboard.":
    "U verifikua duke riluajtur përpjekjet në server. Kjo ishte lojë si mysafir, ndaj nuk është në renditje.",
  "You've played today's word": "E ke luajtur fjalën e sotme",
  guess: "përpjekje",
  guesses: "përpjekje",
  "{n} {guesses} left.": "Të mbeten {n} {guesses}.",
  "{word} isn't in the word list.": "{word} nuk është në listën e fjalëve.",
  "right place": "vendi i duhur",
  elsewhere: "diku tjetër",
  "not in the word": "nuk është në fjalë",
  // Whittle
  "Bigger numbers from here: up to 14.": "Nga këtu numra më të mëdhenj: deri në 14.",
  "Hard boards from here: numbers up to 19.": "Tabela të vështira nga këtu: numra deri në 19.",
  "{met} of {total} targets met": "{met} nga {total} objektiva të arritura",
  "Board {level}, {side} by {side2}": "Tabela {level}, {side} me {side2}",
  "Board {n} solved, +{gain}. Board {level} is {tier}.":
    "Tabela {n} u zgjidh, +{gain}. Tabela {level} është {tier}.",
  "Tap a number to cross it out. Each row and column must add up to its target.":
    "Prek një numër për ta hequr. Çdo rresht dhe kolonë duhet të mblidhet sa objektivi i vet.",
  "Tap again to circle a number you're keeping, and once more to clear it.":
    "Prek sërish për të rrethuar një numër që po e mban, dhe edhe një herë për ta pastruar.",
  "Row {row} column {column}, {number}{mark}": "Rreshti {row} kolona {column}, {number}{mark}",
  ", crossed out": ", i hequr",
  ", circled": ", i rrethuar",
  "{line} {n} target {target}, met": "{line} {n} objektivi {target}, i arritur",
  "{line} {n} target {target}, now {sum}": "{line} {n} objektivi {target}, tani {sum}",
  Column: "Kolona",
  "{wrong} {n} crossed out that had to stay, and {missed} still to cross out.":
    "{wrong} {n} të hequr që duhej të rrinin, dhe {missed} ende për t'u hequr.",
  "No wrong crosses: {missed} {n} still to cross out when the run ended.":
    "Asnjë heqje e gabuar: {missed} {n} ende për t'u hequr kur mbaroi loja.",
  number: "numër",
  numbers: "numra",
  "number was": "numër ishte",
  "numbers were": "numra ishin",
  "The answer to board {level}": "Përgjigjja e tabelës {level}",
  "Board {level} with its answer. {summary}": "Tabela {level} me përgjigjen e saj. {summary}",
  "Crossed: has to go": "I hequr: duhet të ikë",
  "Red: you crossed it, it stays": "I kuq: e hoqe, por rri",
  "Faint: not found yet": "I zbehtë: ende i pagjetur",
};
