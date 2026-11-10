/** Albanian for the hints (`lib/games/hints.ts`, `lib/games/mini-sudoku-hints.ts`). */
export const sqHints: Record<string, string> = {
  "This crown isn't part of the solution. Tap it or use Undo to take it off.":
    "Kjo kurorë nuk është pjesë e zgjidhjes. Preke ose përdor Zhbëj për ta hequr.",
  " — and it holds the most tiles of the columns that would clear":
    " — dhe ka më shumë pllaka nga kolonat që do të pastroheshin",
  "{fits} all fit here, and more than one of them can finish the board. A {digit} works.":
    "{fits} përshtaten të gjitha këtu, dhe më shumë se njëra mund ta përfundojë tabelën. Një {digit} funksionon.",
  "{list} and {last}": "{list} dhe {last}",
  "{name} already has its three {value}, so the rest of it is {n}.":
    "{name} i ka tashmë tre {value}, ndaj pjesa tjetër është {n}.",
  "{name} would have {count} {value}, and only three fit":
    "{name} do të kishte {count} {value}, dhe nxënë vetëm tre",
  "a clash": "një përplasje",
  "A crown here would leave no room for one in {name}. Mark it with an X.":
    "Një kurorë këtu nuk do të linte vend për një tjetër në {name}. Shënoje me X.",
  "column {n}": "kolona {n}",
  "row {n}": "rreshti {n}",
  "row {row}, column {column}": "rreshti {row}, kolona {column}",
  differ: "ndryshojnë",
  match: "përputhen",
  "Every open cell in {name} is in this cell's colour region, so that region's crown must be in {name2} — not here. Mark it with an X.":
    "Çdo kuti e lirë në {name} është në zonën e ngjyrës së kësaj kutie, ndaj kurora e asaj zone duhet të jetë në {name2} — jo këtu. Shënoje me X.",
  "If this were a {value}, the rules would force a clash: {words}. So it's a {n}.":
    "Po të ishte {value}, rregullat do të sillnin një përplasje: {words}. Pra është {n}.",
  "It sits between two {n} in {name}, and three in a row isn't allowed.":
    "Qëndron mes dy {n} në {name}, dhe tre rresht nuk lejohen.",
  "It's the only cell left in {own} where a crown can go: every other one is ruled out by a crown or an X in red.":
    "Është kutia e vetme e mbetur në {own} ku mund të shkojë një kurorë: çdo tjetër përjashtohet nga një kurorë ose një X e kuqe.",
  "its box": "kutia e saj",
  "its colour region": "zona e saj e ngjyrës",
  "Its colour region is this one cell, so the crown goes here.":
    "Zona e saj e ngjyrës është vetëm kjo kuti, ndaj kurora shkon këtu.",
  "its column or box": "kolona ose kutia e saj",
  "its row or box": "rreshti ose kutia e saj",
  "its row or column": "rreshti ose kolona e saj",
  up: "lart",
  down: "poshtë",
  left: "majtas",
  right: "djathtas",
  suns: "diej",
  moons: "hëna",
  "No column reaches exactly 10 with a {tile}. {n} gets closest, at {total}, without going over.":
    "Asnjë kolonë nuk arrin saktësisht 10 me një {tile}. {n} afrohet më shumë, me {total}, pa e kaluar.",
  "No slide merges anything yet. Sliding {name} moves the board so new pairs can line up.":
    "Ende asnjë rrëshqitje nuk bashkon gjë. Rrëshqitja {name} e lëviz tabelën që të rreshtohen çifte të reja.",
  "Nothing bursts yet. Piece {n} at row {row}, column {column} keeps room for the rest of your tray.":
    "Ende asgjë nuk shpërthen. Copa {n} në rreshtin {row}, kolonën {column} lë vend për copat e tjera.",
  "Only {fits} fit here, and with {n} the rest of the board can't be finished — so it's a {digit}.":
    "Vetëm {fits} përshtaten këtu, dhe me {n} pjesa tjetër e tabelës nuk përfundon dot — pra është {digit}.",
  "Only a {digit} fits here: its row, column and box already hold {n}.":
    "Këtu përshtatet vetëm {digit}: rreshti, kolona dhe kutia e saj kanë tashmë {n}.",
  "Only a {n} here lets the board be finished: a {n2} leads to a dead end a few steps on.":
    "Vetëm {n} këtu lejon që tabela të përfundojë: {n2} të çon në rrugë pa krye pas disa hapash.",
  "Row {n} has the most cells out of the checkerboard pattern ({offInRow}). A move flips a cell and its neighbours, so the middle of that cross is in this row.":
    "Rreshti {n} ka më shumë kuti jashtë modelit të shahut ({offInRow}). Një lëvizje kthen një kuti dhe fqinjët e saj, ndaj mesi i atij kryqi është në këtë rresht.",
  "Sliding {name} merges the most tiles of any slide: +{gain}.":
    "Rrëshqitja {name} bashkon më shumë pllaka se çdo rrëshqitje tjetër: +{gain}.",
  "Sliding the {tile} into the gap solves the board.":
    "Rrëshqitja e {tile} në hapësirë e zgjidh tabelën.",
  "Sliding the {tile} leaves {left} {n} to solve the board — the fewest of any move from here.":
    "Rrëshqitja e {tile} lë {left} {n} për ta zgjidhur tabelën — më pak se çdo lëvizje tjetër nga këtu.",
  "that makes three {value} in a row in {name}": "kjo bën tre {value} rresht në {name}",
  "The {n} sign between this cell and {there} means they {n2}, and that one is a {near}.":
    "Shenja {n} mes kësaj kutie dhe {there} do të thotë se {n2}, dhe ajo është {near}.",
  "the {n} sign next to it says the two cells {n2}": "shenja {n} pranë saj thotë se dy kutitë {n2}",
  "The {tile} makes {name} exactly 10, which clears it{n}.":
    "{tile} e bën {name} saktësisht 10, gjë që e pastron{n}.",
  "The board can't be finished as it stands. Start by clearing this {n}.":
    "Tabela nuk përfundon dot siç është. Nis duke e pastruar këtë {n}.",
  "The cells out of the checkerboard pattern are this one and its neighbours above, below, left and right — exactly the cross a tap here flips back.":
    "Kutitë jashtë modelit të shahut janë kjo dhe fqinjët e saj sipër, poshtë, majtas dhe djathtas — pikërisht kryqi që një prekje këtu e kthen mbrapsht.",
  "the outlined colour region": "zona e ngjyrës e skicuar",
  "The outlined colour region only has room in {name}, so {name2}'s crown goes in that region — not here. Mark it with an X.":
    "Zona e skicuar ka vend vetëm në {name}, ndaj kurora e {name2} shkon në atë zonë — jo këtu. Shënoje me X.",
  "This {value} breaks a rule: {words}. It should be a {n}.":
    "Ky {value} shkel një rregull: {words}. Duhet të jetë {n}.",
  "This is the only cell in row {n} that works: a crown anywhere else in that row leads to a dead end further on.":
    "Kjo është kutia e vetme në rreshtin {n} që funksionon: një kurorë gjetkë në atë rresht të çon në rrugë pa krye më tej.",
  "This is the only place in {name} where a {digit} fits: every other empty cell there already sees a {digit2} in {sees}.":
    "Ky është i vetmi vend në {name} ku përshtatet {digit}: çdo kuti tjetër bosh aty sheh tashmë një {digit2} në {sees}.",
  "Two {n} sit next to it in {name}, and three in a row isn't allowed.":
    "Dy {n} qëndrojnë pranë saj në {name}, dhe tre rresht nuk lejohen.",
  "With a {n} here, the rest of the board can't be finished. Clear it.":
    "Me {n} këtu, pjesa tjetër e tabelës nuk përfundon dot. Pastroje.",
  "With a {value} here the board can't be finished — it needs a {n}.":
    "Me {value} këtu tabela nuk përfundon dot — duhet {n}.",
  "{n} all fit here; a {digit} works.": "{n} përshtaten të gjitha këtu; {digit} funksionon.",
  "Of {n}, only a {digit} lets the board be finished.":
    "Nga {n}, vetëm {digit} lejon që tabela të përfundojë.",
  "Only a {digit} fits here: its row, column and box already hold the other digits.":
    "Këtu përshtatet vetëm {digit}: rreshti, kolona dhe kutia e saj kanë tashmë shifrat e tjera.",
  "This is the only place in {name} where a {digit} fits.":
    "Ky është i vetmi vend në {name} ku përshtatet {digit}.",
  // Sumdoku
  "its cage": "kafazi i saj",
  "This {digit} can't stay: there's already a {digit2} in {where}.":
    "Ky {digit} nuk mund të qëndrojë: ka tashmë një {digit2} në {where}.",
  "This cage adds up to {sum} already, past its {total}. This {digit} has to go.":
    "Ky kafaz bën tashmë {sum}, mbi totalin {total}. Ky {digit} duhet hequr.",
  "This cage is full but adds up to {sum}, not {total}. This {digit} has to go.":
    "Ky kafaz është plot por bën {sum}, jo {total}. Ky {digit} duhet hequr.",
  "This cage adds up to {total} and already holds {sum}, so the last cell is a {digit}.":
    "Ky kafaz bën {total} dhe ka tashmë {sum}, ndaj kutia e fundit është {digit}.",
  "Only a {digit} fits here: its row, column and box rule out the rest, and its cage total does the others.":
    "Këtu përshtatet vetëm {digit}: rreshti, kolona dhe kutia përjashtojnë të tjerat, dhe totali i kafazit pjesën tjetër.",
  "{n} all fit here, but only a {digit} lets the board be finished.":
    "Këtu përshtaten {n}, por vetëm {digit} lejon që tabela të mbarojë.",
  "This cage of {size} adds up to {total}; a {digit} goes here.":
    "Ky kafaz me {size} bën {total}; këtu shkon {digit}.",
  // Whittle
  "Row {n} is under its target of {target}: bring this {number} back.":
    "Rreshti {n} është nën objektivin {target}: ktheje këtë {number}.",
  "Column {n} is under its target of {target}: bring this {number} back.":
    "Kolona {n} është nën objektivin {target}: ktheje këtë {number}.",
  "This {number} has to stay: the board can't be finished with it crossed out.":
    "Ky {number} duhet të rrijë: tabela nuk mbaron dot me të të hequr.",
  "This circled {number} can't stay: the board can't be finished around it.":
    "Ky {number} i rrethuar nuk mund të rrijë: tabela nuk mbaron dot me të.",
  "This {number} is bigger than row {n}'s target of {target}, so it has to go.":
    "Ky {number} është më i madh se objektivi {target} i rreshtit {n}, ndaj duhet hequr.",
  "This {number} is bigger than column {n}'s target of {target}, so it has to go.":
    "Ky {number} është më i madh se objektivi {target} i kolonës {n}, ndaj duhet hequr.",
  "Row {n} adds up to {sum} and needs {target}: cross out this {number}.":
    "Rreshti {n} bën {sum} dhe i duhet {target}: hiqe këtë {number}.",
  "Column {n} adds up to {sum} and needs {target}: cross out this {number}.":
    "Kolona {n} bën {sum} dhe i duhet {target}: hiqe këtë {number}.",
  "Row {n} is {over} over its target of {target}. This {number} is part of what goes.":
    "Rreshti {n} është {over} mbi objektivin {target}. Ky {number} është pjesë e asaj që hiqet.",
};
