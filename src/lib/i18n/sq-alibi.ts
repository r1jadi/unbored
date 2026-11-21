/**
 * Albanian for Alibi: its catalogue text, rules and screens. The cases themselves
 * are not here: each one is written in both languages in `lib/games/alibi-bank.ts`,
 * with Albanian names and places in the Albanian.
 */
export const sqAlibi: Record<string, string> = {
  // ── The catalogue ────────────────────────────────────────────────────────────
  Alibi: "Alibi",
  "One of them is lying. Prove it.": "Njëri prej tyre po gënjen. Provoje.",
  "A small mystery every day. Three suspects tell you where they were, and the evidence waits in closed files: a till log, a text message, a receipt, a sign on a wall. One statement doesn't fit the evidence. Find the lie, and the file that proves it.":
    "Një mister i vogël çdo ditë. Tre të dyshuar të tregojnë ku ishin, dhe provat të presin në dosje të mbyllura: një regjistër arke, një mesazh, një faturë, një njoftim në mur. Një deklaratë nuk përputhet me provat. Gjeje gënjeshtrën, dhe dosjen që e vërteton.",
  "Read what each suspect says, then open the files you need; every file opened costs 80 points. To accuse, pick the suspect who is lying and the file that proves it. A first-try solve with only the proof open is worth 920; a wrong accusation costs 300, and a second one closes the case. One ranked case a day; a new one arrives at midnight, your time.":
    "Lexo çfarë thotë secili i dyshuar, pastaj hap dosjet që të duhen; çdo dosje e hapur kushton 80 pikë. Për të akuzuar, zgjidh të dyshuarin që po gënjen dhe dosjen që e vërteton. Një zgjidhje që në provën e parë, me vetëm provën të hapur, vlen 920; një akuzë e gabuar kushton 300, dhe e dyta e mbyll rastin. Një rast i renditur në ditë; një i ri vjen në mesnatë, sipas orës tënde.",

  // ── Rules ────────────────────────────────────────────────────────────────────
  "One of them is lying": "Njëri prej tyre po gënjen",
  "Three suspects, a few files of evidence. Find the lie, and the file that proves it.":
    "Tre të dyshuar, disa dosje me prova. Gjeje gënjeshtrën, dhe dosjen që e vërteton.",
  "Read the statements.": "Lexo deklaratat.",
  "Each suspect says where they were. Two of them are telling the truth.":
    "Secili i dyshuar thotë ku ishte. Dy prej tyre po thonë të vërtetën.",
  "Open the files you need.": "Hap dosjet që të duhen.",
  "Every file opened costs 80 points, so the sharpest detectives open few.":
    "Çdo dosje e hapur kushton 80 pikë, ndaj detektivët më të mprehtë hapin pak.",
  "Accuse with proof.": "Akuzo me prova.",
  "Pick the suspect who is lying and the file that contradicts them. A first-try solve with only the proof open is worth 920.":
    "Zgjidh të dyshuarin që po gënjen dhe dosjen që e kundërshton. Një zgjidhje që në provën e parë, me vetëm provën të hapur, vlen 920.",
  "Two accusations.": "Dy akuza.",
  "A wrong one costs 300, and a second one closes the case. One ranked case a day; a new one arrives at midnight, your time.":
    "Një akuzë e gabuar kushton 300, dhe e dyta e mbyll rastin. Një rast i renditur në ditë; një i ri vjen në mesnatë, sipas orës tënde.",

  // ── The board ────────────────────────────────────────────────────────────────
  "Open today's case": "Hap rastin e sotëm",
  "Fetching today's case…": "Po merret rasti i sotëm…",
  "You've solved today's case": "E ke zgjidhur rastin e sotëm",
  "Worth {points}": "Vlen {points}",
  "A past case": "Një rast i kaluar",
  Suspects: "Të dyshuarit",
  Evidence: "Provat",
  "Open · −{points}": "Hap · −{points}",
  "Open a file first: an accusation needs proof.":
    "Hap fillimisht një dosje: akuza ka nevojë për prova.",
  "Pick the suspect who is lying, then the file that proves it.":
    "Zgjidh të dyshuarin që po gënjen, pastaj dosjen që e vërteton.",
  "You've already made that accusation.": "Këtë akuzë e ke bërë tashmë.",
  "That doesn't hold up. One accusation left.": "Kjo nuk qëndron. Të ka mbetur një akuzë.",
  "Accusations left:": "Akuza të mbetura:",
  "{n} accusations left": "{n} akuza të mbetura",
  Accuse: "Akuzo",
  "Back to the files": "Kthehu te dosjet",
  "Make an accusation": "Bëj një akuzë",
  "Close the case": "Mbyll rastin",
  "Close this case?": "Ta mbyllësh këtë rast?",
  "Close today's case?": "Ta mbyllësh rastin e sotëm?",
  "The case ends unsolved and you'll see who did it. It's practice, so nothing is lost.":
    "Rasti mbyllet pa u zgjidhur dhe do të shohësh kush e bëri. Është praktikë, ndaj nuk humbet asgjë.",
  "The case ends unsolved, scores nothing, and you'll see who did it. There is one ranked case a day.":
    "Rasti mbyllet pa u zgjidhur, nuk merr pikë, dhe do të shohësh kush e bëri. Ka një rast të renditur në ditë.",
  "Keep investigating": "Vazhdo hetimin",

  // ── The result ───────────────────────────────────────────────────────────────
  "Files opened": "Dosje të hapura",
  Accusations: "Akuza",
  "{n} of 3 stars": "{n} nga 3 yje",
  "Case closed!": "Rasti u mbyll!",
  "The liar got away": "Gënjeshtari shpëtoi",
  "The liar": "Gënjeshtari",
  "The proof": "Prova",
  "Liked this? Powehi has full-length cases to solve alone or with friends.":
    "Të pëlqeu? Powehi ka raste të plota për t'i zgjidhur vetëm ose me shokë.",
  "Try Powehi →": "Provo Powehi →",

  // ── The feed preview ─────────────────────────────────────────────────────────
  "The gardener": "Kopshtari",
  "The chef": "Kuzhinieri",
  "The guest": "Mysafiri",
  "Bus ticket": "Bileta e autobusit",
  "Door log": "Regjistri i derës",
  "Text message": "Mesazhi",
};
