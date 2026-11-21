/**
 * Alibi's cases: the text a player reads. Day `d` plays case `d mod n`.
 *
 * Every case is written twice, once for each language, and each language gets its
 * own world: English names, places and pounds in English; Albanian names, places
 * and euros or lekë in Albanian. The story, the times, the clues and the answer are
 * the same in both — `alibi.test.ts` checks that every `HH:MM` in a case's English
 * also appears in its Albanian, so the clues cannot drift apart.
 *
 * The answers (who is lying, which card proves it, and the reveal) are not here:
 * they are in `alibi-answers.ts`, which the runtime loads only when a run starts,
 * and in `public.alibi_case` in
 * `supabase/migrations/20270122120000_alibi_sessions.sql`, written by
 * `bun scripts/generate-daily-banks.ts --write`. Suspects and cards are addressed
 * by their place in these lists, so only ever append: a new case at the end, and
 * never reorder a case's suspects or cards.
 *
 * The rule the player is told: one of them is lying, find the lie and the card
 * that proves it. Exactly one statement in a case is contradicted by a card; the
 * other two fit every card, however suspicious those people look.
 */

/** English and Albanian side by side, so a case is reviewed and checked as one unit. */
export type Text = { readonly en: string; readonly sq: string };

export type CardKind = "log" | "message" | "receipt" | "notice" | "report" | "photo";

export type Suspect = {
  /** A role, the same in both languages: names differ, the answer must not. */
  readonly id: string;
  readonly name: Text;
  readonly role: Text;
  /** Two to four short sentences. */
  readonly statement: Text;
  /** When it matters to the case: "Statement taken at 10:30". */
  readonly statedAt?: Text;
};

export type Card = {
  readonly id: string;
  /** Picks the card's look: a log, a text bubble, a receipt… */
  readonly kind: CardKind;
  readonly title: Text;
  /** About forty words at most, so it reads on a phone. */
  readonly body: Text;
};

export type AlibiCase = {
  /** A stable slug. */
  readonly id: string;
  readonly title: Text;
  readonly setting: Text;
  /** What happened, the time window, and "one of them is lying". */
  readonly setup: Text;
  readonly suspects: readonly [Suspect, Suspect, Suspect];
  /** Four to six. */
  readonly cards: readonly Card[];
};

const tx = (en: string, sq: string): Text => ({ en, sq });

export const ALIBI_CASES: readonly AlibiCase[] = [
  {
    id: "tip-jar",
    title: tx("The Tip Jar", "Kavanoza e bakshishit"),
    setting: tx("Bristol · Saturday afternoon", "Prishtinë · e shtunë pasdite"),
    setup: tx(
      "Saturday afternoon at the Corner Café in Bristol. The tip jar on the counter, about £60, vanished sometime between 15:30 and 15:48. Three people could have taken it. One of them is lying.",
      "E shtunë pasdite në Kafen e Qoshes, në Prishtinë. Kavanoza e bakshishit mbi banak, rreth 60 €, u zhduk diku mes orës 15:30 dhe 15:48. Tre persona mund ta kenë marrë. Njëri prej tyre po gënjen.",
    ),
    suspects: [
      {
        id: "barista",
        name: tx("Amy Brooks", "Arta Berisha"),
        role: tx("Barista", "Banakiere"),
        statement: tx(
          "I took my break at three, out the back door. When I came back at half past, the jar was still there. I made two coffees, turned round, and it was gone.",
          "Pushimin e mora në ora tre, dola nga dera e pasme. Kur u ktheva në tre e gjysmë, kavanoza ishte ende aty. Bëra dy kafe, u ktheva dhe ajo s'ishte më.",
        ),
      },
      {
        id: "customer",
        name: tx("Ben Hughes", "Blerim Hoxha"),
        role: tx("Regular customer, writer", "Klient i rregullt, shkrimtar"),
        statement: tx(
          "I sat at my window table from two until five, writing. I only went to the counter when I left, to pay.",
          "Ndenja në tavolinën time pranë dritares nga ora dy deri në pesë, duke shkruar. Te banaku shkova vetëm kur ika, për të paguar.",
        ),
      },
      {
        id: "cleaner",
        name: tx("Dan Carter", "Driton Krasniqi"),
        role: tx("Cleaner", "Pastrues"),
        statement: tx(
          "My shift starts at half four. I came in through the back at 16:30 and Amy told me straight away the jar was gone. I wasn't anywhere near the café before that.",
          "Turni im fillon në katër e gjysmë. Hyra nga dera e pasme në 16:30 dhe Arta më tha menjëherë që kavanoza ishte zhdukur. Para kësaj nuk isha fare afër kafenesë.",
        ),
      },
    ],
    cards: [
      {
        id: "text",
        kind: "message",
        title: tx("Amy → the manager, 15:48", "Arta → menaxheri, 15:48"),
        body: tx(
          "Tip jar's gone 😡 It was there at 15:30 when I got back from break. I swear I only turned my back for a minute.",
          "Kavanoza e bakshishit u zhduk 😡 Ishte aty në 15:30 kur u ktheva nga pushimi. Të betohem, vetëm për një minutë ia ktheva shpinën.",
        ),
      },
      {
        id: "back-door",
        kind: "log",
        title: tx(
          "Back door: staff key cards, Saturday",
          "Dera e pasme: kartelat e stafit, e shtunë",
        ),
        body: tx(
          "15:29 Amy B. · 15:36 Dan C. · 16:31 Dan C. Each staff member has their own card. The front door has no card reader.",
          "15:29 Arta B. · 15:36 Driton K. · 16:31 Driton K. Çdo punonjës ka kartelën e vet. Dera e përparme nuk ka lexues kartelash.",
        ),
      },
      {
        id: "camera",
        kind: "report",
        title: tx("Front camera, 15:30–15:48", "Kamera e përparme, 15:30–15:48"),
        body: tx(
          "The camera faces the street door. No one enters or leaves through the front in that time.",
          "Kamera sheh nga dera e rrugës. Askush nuk hyn e as del nga përpara gjatë kësaj kohe.",
        ),
      },
      {
        id: "note",
        kind: "photo",
        title: tx("Found under Ben's table", "Gjetur nën tavolinën e Blerimit"),
        body: tx(
          "A sticky note: “RENT due Monday: £350!!”",
          "Një letër ngjitëse: “QIRAJA të hënën: 350 €!!”",
        ),
      },
      {
        id: "receipt",
        kind: "receipt",
        title: tx("Till receipt, 17:02", "Fatura, 17:02"),
        body: tx(
          "Table 4 (window): 3 × flat white, 1 × water, £11.40. Paid by card, B. Hughes.",
          "Tavolina 4 (dritarja): 3 × makiato, 1 × ujë, 4,80 €. Paguar me kartelë, B. Hoxha.",
        ),
      },
    ],
  },
  {
    id: "wedding-cake",
    title: tx("A Slice Too Soon", "Një fetë para kohe"),
    setting: tx("Brighton · a wedding morning", "Durrës · mëngjesi i një dasme"),
    setup: tx(
      "The Bayview Hotel, Brighton, on a wedding day. The cake for the 13:00 reception was finished at 9:30 and put in the kitchen's walk-in fridge. At noon someone noticed a large slice was already missing. One of these three is lying.",
      "Hotel Adriatik, Durrës, ditë dasme. Torta për pritjen e orës 13:00 u përfundua në 9:30 dhe u vendos në frigoriferin e madh të kuzhinës. Në mesditë dikush vuri re që mungonte tashmë një fetë e madhe. Njëri nga këta të tre po gënjen.",
    ),
    suspects: [
      {
        id: "cousin",
        name: tx("Chloe Harris", "Klea Hasani"),
        role: tx("The bride's cousin", "Kushërira e nuses"),
        statement: tx(
          "I was at the hairdresser in town from ten until twelve. Look at this hair. Do you think that took ten minutes?",
          "Isha te parukeria në qytet nga ora dhjetë deri në dymbëdhjetë. Shiko këto flokë. Mendon se u bënë për dhjetë minuta?",
        ),
      },
      {
        id: "pastry-chef",
        name: tx("Eric Dawson", "Ermal Dushi"),
        role: tx("Pastry chef", "Pastiçier"),
        statement: tx(
          "I finished the cake at half nine, put it in the walk-in and went home to sleep. I didn't come back until half twelve.",
          "E mbarova tortën në nëntë e gjysmë, e futa në frigorifer dhe shkova në shtëpi të fle. U ktheva vetëm në dymbëdhjetë e gjysmë.",
        ),
      },
      {
        id: "best-friend",
        name: tx("Gary Lewis", "Genti Leka"),
        role: tx("The groom's best friend", "Shoku i ngushtë i dhëndrit"),
        statement: tx(
          "I spent the whole morning at the pool bar practising my speech. Ask the waiter, I had three coffees.",
          "Gjithë mëngjesin e kalova te bari i pishinës duke e ushtruar fjalimin. Pyete kamarierin, piva tri kafe.",
        ),
      },
    ],
    cards: [
      {
        id: "pool-sign",
        kind: "notice",
        title: tx("Sign at reception", "Njoftim në recepsion"),
        body: tx(
          "The pool and pool bar are CLOSED today, 08:00–13:00, for cleaning. We apologise for the inconvenience.",
          "Pishina dhe bari i pishinës janë të MBYLLURA sot, 08:00–13:00, për pastrim. Na falni për shqetësimin.",
        ),
      },
      {
        id: "salon",
        kind: "receipt",
        title: tx("Belle Hair", "Sallon Bukuria"),
        body: tx(
          "Chloe H.: updo and make-up, 10:05 to 11:50. £85, paid cash.",
          "Klea H.: model flokësh dhe grim, 10:05 deri 11:50. 45 €, paguar me para në dorë.",
        ),
      },
      {
        id: "fridge",
        kind: "log",
        title: tx("Walk-in fridge door", "Dera e frigoriferit"),
        body: tx(
          "09:31 pastry code · 11:14 master key · 12:02 kitchen code",
          "09:31 kodi i pastiçerisë · 11:14 çelësi kryesor · 12:02 kodi i kuzhinës",
        ),
      },
      {
        id: "front-desk",
        kind: "report",
        title: tx("Front desk book", "Libri i recepsionit"),
        body: tx(
          "11:05: master kitchen key lent to “the wedding party, to put drinks in the fridge”. Returned 11:20. Signature unreadable.",
          "11:05: çelësi kryesor i kuzhinës iu dha “dasmorëve, për të futur pijet në frigorifer”. U kthye në 11:20. Nënshkrimi nuk lexohet.",
        ),
      },
      {
        id: "chef-text",
        kind: "message",
        title: tx("Eric → a friend, 08:10", "Ermali → një shoku, 08:10"),
        body: tx(
          "They're paying me half what this cake is worth. Never again.",
          "Po më paguajnë gjysmën e asaj që vlen kjo tortë. Kurrë më.",
        ),
      },
      {
        id: "housekeeping",
        kind: "report",
        title: tx("Housekeeping, 11:40", "Pastrimi, 11:40"),
        body: tx(
          "Buttercream fingerprints on the second-floor corridor railing. Rooms on that floor include 204 (Chloe H.) and 207 (G. Lewis).",
          "Gjurmë gishtash me krem gjalpi në parmakun e korridorit të katit të dytë. Në atë kat janë edhe dhomat 204 (Klea H.) dhe 207 (G. Leka).",
        ),
      },
    ],
  },
  {
    id: "prize-marrow",
    title: tx("The Prize Marrow", "Kungulli fitues"),
    setting: tx(
      "Little Hadley · the morning of the village show",
      "Dardhë, Korçë · mëngjesi i panairit të fshatit",
    ),
    setup: tx(
      "Little Hadley's village show. On judging morning, Mrs Pell's giant marrow, the favourite to win for the fourth year running, was found smashed in the produce tent. The tent was locked from 20:00 the night before until 07:00. One of these three is lying.",
      "Panairi i fshatit në Dardhë. Në mëngjesin e vlerësimit, kungulli gjigant i zonjës Prifti, favorit për të fituar për të katërtin vit radhazi, u gjet i copëtuar në tendën e prodhimeve. Tenda ishte e kyçur nga ora 20:00 e mbrëmjes deri në 07:00. Njëri nga këta të tre po gënjen.",
    ),
    suspects: [
      {
        id: "rival",
        name: tx("Colin Barnes", "Kolë Bardhi"),
        role: tx("Rival grower", "Kultivues rival"),
        statement: tx(
          "I was at the pub quiz at the Fox until eleven, then straight home to bed. I heard about it at eight this morning like everyone else.",
          "Isha në kuizin e kafe-barit Dhelpra deri në njëmbëdhjetë, pastaj drejt e në shtëpi për të fjetur. Mora vesh në tetë të mëngjesit, si gjithë të tjerët.",
        ),
      },
      {
        id: "secretary",
        name: tx("Judith Reyes", "Jeta Rama"),
        role: tx("Show secretary", "Sekretarja e panairit"),
        statement: tx(
          "I locked the tent at eight and took the key home. When I opened up at seven this morning, the marrow was already in pieces.",
          "E kyça tendën në tetë dhe e mora çelësin në shtëpi. Kur e hapa në shtatë të mëngjesit, kungulli ishte tashmë copa-copa.",
        ),
      },
      {
        id: "grandson",
        name: tx("Tom Pell", "Toni Prifti"),
        role: tx("Mrs Pell's grandson", "Nipi i zonjës Prifti"),
        statement: tx(
          "Gran rang me in tears at half seven. All I know is what she told me. Who smashes a prize marrow with a garden spade? It's unbelievable.",
          "Gjyshja më mori në telefon duke qarë në shtatë e gjysmë. Di vetëm atë që më tha ajo. Kush e copëton një kungull fitues me lopatë kopshti? Është e pabesueshme.",
        ),
        statedAt: tx("Statement taken at 10:30", "Deklarata u mor në 10:30"),
      },
    ],
    cards: [
      {
        id: "notebook",
        kind: "report",
        title: tx("PC Dodd's notebook", "Blloku i policit Dedaj"),
        body: tx(
          "09:10: Found a garden spade with a cracked handle hidden behind the tent. The weapon is NOT to be mentioned to anyone until further notice.",
          "09:10: Gjeta një lopatë kopshti me bisht të plasaritur, të fshehur pas tendës. Për armën të mos i thuhet ASKUJT deri në njoftim të dytë.",
        ),
      },
      {
        id: "quiz",
        kind: "receipt",
        title: tx("The Fox, quiz night", "Kafe-bari Dhelpra, mbrëmja e kuizit"),
        body: tx(
          "Team “Marrow Kings” (C. Barnes + 3): 2nd place. Quiz ended 22:55.",
          "Ekipi “Mbretërit e Kungujve” (K. Bardhi + 3): vendi i 2-të. Kuizi mbaroi në 22:55.",
        ),
      },
      {
        id: "results",
        kind: "notice",
        title: tx("Show results, last three years", "Rezultatet e panairit, tri vitet e fundit"),
        body: tx(
          "Giant Marrow class. 1st: Mrs E. Pell · 2nd: C. Barnes (all three years).",
          "Kategoria Kungulli Gjigant. 1: zonja L. Prifti · 2: K. Bardhi (të tri vitet).",
        ),
      },
      {
        id: "tent",
        kind: "report",
        title: tx("The tent at 07:00", "Tenda në 07:00"),
        body: tx(
          "Padlock undamaged. One side of the tent had its ties undone. Anyone could have crawled in.",
          "Dryni i padëmtuar. Njëra anë e tendës ishte zgjidhur nga lidhëset. Kushdo mund të hynte zvarrë.",
        ),
      },
      {
        id: "diary",
        kind: "message",
        title: tx("Judith's diary", "Ditari i Jetës"),
        body: tx(
          "Mrs P. complained about how I run the show AGAIN. Insufferable woman.",
          "Zonja P. u ankua SËRISH për mënyrën si e organizoj panairin. Grua e padurueshme.",
        ),
      },
      {
        id: "grandson-text",
        kind: "message",
        title: tx(
          "Tom → a friend, 19:40 the night before",
          "Toni → një shoku, 19:40 mbrëmjen e kaluar",
        ),
        body: tx(
          "If Gran wins again she'll make me drive her to the county show. Three days in a tent. Not happening.",
          "Nëse fiton prapë gjyshja, do më detyrojë ta çoj në panairin e qarkut. Tri ditë në tendë. S'ka shans.",
        ),
      },
    ],
  },
  {
    id: "cut-roses",
    title: tx("The Cut Roses", "Trëndafilat e prerë"),
    setting: tx("Norwich · Sunday morning", "Gjakovë · e diel në mëngjes"),
    setup: tx(
      "The night before the town's garden competition, someone cut every bloom from Mrs Ward's rose bed. She last saw them at 23:00; at 07:30 only stalks were left. One of these three is lying.",
      "Natën para garës së kopshteve të qytetit, dikush i preu të gjitha lulet e trëndafilave të zonjës Bardha. Ajo i pa për herë të fundit në 23:00; në 07:30 kishin mbetur vetëm kërcejtë. Njëri nga këta të tre po gënjen.",
    ),
    suspects: [
      {
        id: "jogger",
        name: tx("Sam Rowe", "Sami Rexha"),
        role: tx("Neighbour across the road", "Fqinji përballë"),
        statement: tx(
          "I went for my run at six, round the park and back. Lovely dry morning, I didn't even need a jacket. I didn't notice anything by her garden.",
          "Dola për vrap në gjashtë, një xhiro nëpër park dhe u ktheva. Mëngjes i bukur e i thatë, s'më duhej as xhaketë. Pranë kopshtit të saj nuk vura re asgjë.",
        ),
      },
      {
        id: "neighbour",
        name: tx("Peter Hale", "Petrit Hoti"),
        role: tx("Next-door neighbour", "Fqinji ngjitur"),
        statement: tx(
          "I went to bed at eleven and slept right through. I didn't hear a thing until Mrs Ward started shouting.",
          "Shkova të fle në njëmbëdhjetë dhe fjeta pa u zgjuar. Nuk dëgjova asgjë derisa zonja Bardha filloi të bërtiste.",
        ),
      },
      {
        id: "delivery",
        name: tx("Lucy Grant", "Luan Gashi"),
        role: tx("Paper girl", "Shpërndarës i bukës"),
        statement: tx(
          "I did my round at half six as usual. I put the paper through her door and saw nothing odd. The roses? I didn't look.",
          "Shpërndarjen e bëra në gjashtë e gjysmë si zakonisht. Ia lashë bukën te dera dhe s'pashë asgjë të çuditshme. Trëndafilat? S'i shikova.",
        ),
      },
    ],
    cards: [
      {
        id: "entries",
        kind: "notice",
        title: tx("Garden competition entries", "Pjesëmarrësit në garën e kopshteve"),
        body: tx(
          "Best Roses: Mrs J. Ward (winner, last two years) · Mr P. Hale (runner-up, last two years).",
          "Trëndafilat më të bukur: zonja Bardha (fituese, dy vitet e fundit) · z. P. Hoti (i dyti, dy vitet e fundit).",
        ),
      },
      {
        id: "weather",
        kind: "report",
        title: tx("Weather station, Sunday", "Stacioni meteorologjik, e diel"),
        body: tx(
          "04:00–07:00: heavy rain, 9 mm. Dry from 07:10.",
          "04:00–07:00: shi i dendur, 9 mm. I thatë nga 07:10.",
        ),
      },
      {
        id: "round-sheet",
        kind: "log",
        title: tx("Paper round sheet", "Fleta e shpërndarjes, Furra Ylli"),
        body: tx(
          "Hollins Road, no. 12 (Ward): delivered 06:34 ✓",
          "Rruga e Trëndafilave, nr. 12 (Bardha): dorëzuar 06:34 ✓",
        ),
      },
      {
        id: "sleep",
        kind: "log",
        title: tx("Peter's sleep tracker", "Ora e gjumit e Petritit"),
        body: tx(
          "Asleep 23:12 to 07:20. No time awake.",
          "Në gjumë nga 23:12 deri në 07:20. Asnjë zgjim.",
        ),
      },
      {
        id: "secateurs",
        kind: "photo",
        title: tx("Found in the hedge", "Gjetur në gardh"),
        body: tx(
          "A pair of garden secateurs, wet and muddy, pushed into the hedge by Mrs Ward's gate.",
          "Një palë gërshërë kopshti, të lagura e me baltë, të futura në gardhin pranë portës së zonjës Bardha.",
        ),
      },
    ],
  },
  {
    id: "deleted-pitch",
    title: tx("The Deleted Pitch", "Prezantimi i fshirë"),
    setting: tx("Manchester · Thursday night", "Tiranë · e enjte natën"),
    setup: tx(
      "The night before a big pitch at Brightwell Design, someone deleted the team's presentation from the shared drive at 21:47, from a computer inside the office. One of these three is lying.",
      "Natën para një prezantimi të madh në studion e dizajnit “Vija”, dikush e fshiu prezantimin e ekipit nga drive-i i përbashkët në 21:47, nga një kompjuter brenda zyrës. Njëri nga këta të tre po gënjen.",
    ),
    suspects: [
      {
        id: "designer",
        name: tx("Hannah Price", "Hana Pllana"),
        role: tx("Senior designer", "Dizajnere e lartë"),
        statement: tx(
          "I left at six and was home all evening. My flatmate can tell you.",
          "Ika në gjashtë dhe isha në shtëpi gjithë mbrëmjen. Ta thotë shoqja ime e banesës.",
        ),
      },
      {
        id: "intern",
        name: tx("Oliver Shaw", "Olsi Shehu"),
        role: tx("Intern", "Praktikant"),
        statement: tx(
          "I stayed late to finish the logo files. I left at half nine on the dot, because my bus is at 21:40. The office was empty when I went.",
          "Ndenja deri vonë për të mbaruar skedarët e logos. Ika fiks në nëntë e gjysmë, sepse autobusi im është në 21:40. Kur ika, zyra ishte bosh.",
        ),
      },
      {
        id: "manager",
        name: tx("Rachel Moore", "Rudina Muka"),
        role: tx("Studio manager", "Menaxhere e studios"),
        statement: tx(
          "I was at the client dinner from seven until eleven. I never came back to the office.",
          "Isha në darkën me klientin nga ora shtatë deri në njëmbëdhjetë. Në zyrë nuk u ktheva më.",
        ),
      },
    ],
    cards: [
      {
        id: "drive",
        kind: "log",
        title: tx("Shared drive history", "Historia e drive-it të përbashkët"),
        body: tx(
          "21:47: “Pitch_FINAL” deleted, from the shared hot desk. The bin was emptied a minute later.",
          "21:47: “Prezantimi_FINAL” u fshi, nga tavolina e përbashkët. Koshi u zbraz një minutë më vonë.",
        ),
      },
      {
        id: "designer-text",
        kind: "message",
        title: tx("Hannah → Rachel, 17:30", "Hana → Rudina, 17:30"),
        body: tx(
          "If my design isn't the lead tomorrow, I honestly don't know why I bother.",
          "Nëse dizajni im nuk del i pari nesër, vërtet s'e di pse mundohem.",
        ),
      },
      {
        id: "bus",
        kind: "notice",
        title: tx("Bus timetable, Oxford Road", "Orari i autobusit, Unaza"),
        body: tx("Route 42: 21:10, 21:40, 22:10.", "Linja Unaza: 21:10, 21:40, 22:10."),
      },
      {
        id: "badges",
        kind: "log",
        title: tx("Front door badge log, Thursday", "Kartelat në derën kryesore, e enjte"),
        body: tx(
          "18:02 H. Price OUT · 21:58 O. Shaw OUT. Everyone badges out; the door won't open otherwise.",
          "18:02 H. Pllana DALJE · 21:58 O. Shehu DALJE. Çdokush del me kartelë; ndryshe dera nuk hapet.",
        ),
      },
      {
        id: "dinner",
        kind: "receipt",
        title: tx("The Ivy Room", "Restorant Lisi"),
        body: tx(
          "Table for six, 19:05 to 22:55. Paid by R. Moore.",
          "Tavolinë për gjashtë, 19:05 deri 22:55. Paguar nga R. Muka.",
        ),
      },
    ],
  },
  {
    id: "tuck-shop",
    title: tx("The Midnight Feast", "Gosti në mesnatë"),
    setting: tx(
      "Lake District · a summer camp, Wednesday night",
      "Brezovicë · kamp veror, e mërkurë natën",
    ),
    setup: tx(
      "At Camp Pinewood, someone raided the tuck shop overnight: forty chocolate bars gone. The shop was locked at 22:00 and found open at 07:00. One of these three campers is lying.",
      "Në kampin “Pishat”, dikush e zbrazi dyqanin e ëmbëlsirave gjatë natës: mungonin dyzet çokollata. Dyqani u mbyll në 22:00 dhe u gjet i hapur në 07:00. Njëri nga këta tre kampistë po gënjen.",
    ),
    suspects: [
      {
        id: "light-sleeper",
        name: tx("Josh Reed", "Jon Rexhepi"),
        role: tx("Camper, cabin 5", "Kampist, kabina 5"),
        statement: tx(
          "I got up at one because Leo's snoring woke me. I went to the toilet block and straight back, two minutes. I never went near the shop.",
          "U ngrita në një, sepse më zgjoi gërhitja e Leonit. Shkova te banjat dhe u ktheva menjëherë, dy minuta. Afër dyqanit nuk shkova fare.",
        ),
      },
      {
        id: "deep-sleeper",
        name: tx("Mia Collins", "Mira Kelmendi"),
        role: tx("Camper, cabin 3", "Kampiste, kabina 3"),
        statement: tx(
          "I fell asleep the second I lay down, about half ten. I didn't wake up once until the breakfast bell.",
          "Më zuri gjumi sa u shtriva, rreth dhjetë e gjysmë. Nuk u zgjova asnjëherë deri te zilja e mëngjesit.",
        ),
      },
      {
        id: "snorer",
        name: tx("Leo Fisher", "Leon Fetahu"),
        role: tx("Camper, cabin 5", "Kampist, kabina 5"),
        statement: tx(
          "I was asleep all night. Ask Josh, apparently I snore.",
          "Fjeta gjithë natën. Pyete Jonin, thotë se gërhas.",
        ),
      },
    ],
    cards: [
      {
        id: "padlock",
        kind: "report",
        title: tx("The tuck shop at 07:00", "Dyqani në 07:00"),
        body: tx(
          "Padlock opened, not broken. The spare key hangs in the camp kitchen, which is never locked.",
          "Dryni i hapur, jo i thyer. Çelësi rezervë varet në kuzhinën e kampit, që nuk kyçet kurrë.",
        ),
      },
      {
        id: "toilets",
        kind: "log",
        title: tx("Toilet block door sensor", "Sensori i derës së banjave"),
        body: tx(
          "01:04 opened · 01:06 opened. No other openings between 23:00 and 06:30.",
          "01:04 u hap · 01:06 u hap. Asnjë hapje tjetër mes 23:00 dhe 06:30.",
        ),
      },
      {
        id: "wrappers",
        kind: "photo",
        title: tx("Found in Leo's bag", "Gjetur në çantën e Leonit"),
        body: tx(
          "Twelve sweet wrappers, all “Fizz Pops”. The tuck shop doesn't sell Fizz Pops.",
          "Dymbëdhjetë letra karamelesh, të gjitha “Fishkëllima”. Dyqani i kampit nuk shet “Fishkëllima”.",
        ),
      },
      {
        id: "leader",
        kind: "notice",
        title: tx("Camp leader's notebook", "Blloku i udhëheqëses së kampit"),
        body: tx(
          "Leo: second warning this week for snacks in the cabin. Lights out 22:30.",
          "Leoni: paralajmërimi i dytë këtë javë për ushqime në kabinë. Dritat fiken në 22:30.",
        ),
      },
      {
        id: "band",
        kind: "log",
        title: tx(
          "Mia's fitness band, Wednesday night",
          "Byzylyku i fitnesit (Mira K.), e mërkurë natën",
        ),
        body: tx(
          "22:34–00:55 asleep · 00:58–01:31 awake, 1,412 steps · 01:35–07:00 asleep.",
          "22:34–00:55 në gjumë · 00:58–01:31 zgjuar, 1.412 hapa · 01:35–07:00 në gjumë.",
        ),
      },
    ],
  },
  {
    id: "broken-window",
    title: tx("The Broken Window", "Xhami i thyer"),
    setting: tx("Whitby · a December evening", "Prizren · një mbrëmje dhjetori"),
    setup: tx(
      "At 19:45 on 12 December, someone threw a stone through the window of Hart's Hardware on the High Street. One of these three is lying.",
      "Në 19:45, më 12 dhjetor, dikush hodhi një gur në xhamin e hekurishtes së Hasanit në rrugën kryesore. Njëri nga këta të tre po gënjen.",
    ),
    suspects: [
      {
        id: "witness",
        name: tx("Nora Blake", "Nora Bytyqi"),
        role: tx("Lives above the café opposite", "Banon mbi kafenenë përballë"),
        statement: tx(
          "I saw the whole thing from my window. A boy in a red hoodie threw it. I saw his face clear as day in the evening sun, then he ran off towards the harbour.",
          "E pashë gjithçka nga dritarja. E hodhi një djalë me duks të kuq. Ia pashë fytyrën qartë në diellin e mbrëmjes, pastaj iku me vrap drejt Lumbardhit.",
        ),
      },
      {
        id: "rival-shop",
        name: tx("Gavin Marsh", "Gëzim Pajaziti"),
        role: tx("Owns the shop across the street", "Pronar i dyqanit përballë"),
        statement: tx(
          "I closed up at half five and was home watching the football by seven. I only heard about it the next morning.",
          "E mbylla dyqanin në pesë e gjysmë dhe në shtatë isha në shtëpi duke parë futboll. Mora vesh vetëm të nesërmen në mëngjes.",
        ),
      },
      {
        id: "teenager",
        name: tx("Ryan Cole", "Rron Morina"),
        role: tx("Sixteen, owns a red hoodie", "Gjashtëmbëdhjetë vjeç, ka një duks të kuq"),
        statement: tx(
          "I was at football training at the leisure centre from seven till nine. The coach takes a register.",
          "Isha në stërvitje futbolli në palestrën e qytetit nga ora shtatë deri në nëntë. Trajneri mban listë prezence.",
        ),
      },
    ],
    cards: [
      {
        id: "register",
        kind: "log",
        title: tx("Leisure centre training register", "Lista e prezencës, palestra e qytetit"),
        body: tx(
          "Under-17s, 12 December, 19:00–21:00. R. Cole: present ✓.",
          "U-17, 12 dhjetor, 19:00–21:00. R. Morina: i pranishëm ✓.",
        ),
      },
      {
        id: "rival-text",
        kind: "message",
        title: tx("Gavin → Mr Hart, last week", "Gëzimi → Hasanit, javën e kaluar"),
        body: tx(
          "Your half-price sale is killing my business. You'll regret it.",
          "Ulja jote gjysmë-çmimi po ma vret biznesin. Do të pendohesh.",
        ),
      },
      {
        id: "almanac",
        kind: "notice",
        title: tx("Almanac, 12 December", "Kalendari, 12 dhjetor"),
        body: tx(
          "Sunset: 15:50. Council notice: the High Street lamps have been out since November, so evenings there are pitch dark.",
          "Perëndimi i diellit: 15:50. Njoftim i komunës: llambat e rrugës kryesore nuk ndizen që nga nëntori, ndaj në mbrëmje rruga është krejt e errët.",
        ),
      },
      {
        id: "letter",
        kind: "photo",
        title: tx("Nora's letter to the council", "Letra e Norës për komunën"),
        body: tx(
          "Third complaint this year: Hart's deliveries block my door every morning. If nobody acts, I will.",
          "Ankesa e tretë këtë vit: furnizimet e Hasanit ma bllokojnë derën çdo mëngjes. Nëse s'bën dikush diçka, do ta bëj unë.",
        ),
      },
    ],
  },
  {
    id: "silent-dog",
    title: tx("The Dog That Didn't Bark", "Qeni që nuk lehu"),
    setting: tx("Reading · Friday night", "Pejë · e premte natën"),
    setup: tx(
      "On Friday night someone took the Morgans' new e-scooter from their back garden. Their dog, Biscuit, barks at every stranger, but he didn't make a sound all night. One of these three is lying.",
      "Të premten natën dikush ia mori familjes Kastrati trotinetin e ri elektrik nga oborri i pasmë. Qeni i tyre, Murri, i leh çdo të panjohuri, por gjithë natën nuk nxori zë. Njëri nga këta të tre po gënjen.",
    ),
    suspects: [
      {
        id: "next-door",
        name: tx("Chris Doyle", "Kreshnik Dema"),
        role: tx("Next-door neighbour", "Fqinji ngjitur"),
        statement: tx(
          "Biscuit knows me, sure, I've lived next door for ten years. But I was at my brother's wedding until two in the morning.",
          "Murri më njeh, sigurisht, jam fqinj prej dhjetë vjetësh. Por isha në dasmën e vëllait deri në dy të natës.",
        ),
      },
      {
        id: "house-cleaner",
        name: tx("Priya Shah", "Pranvera Shala"),
        role: tx("The Morgans' cleaner", "Pastruese te familja Kastrati"),
        statement: tx(
          "I only clean there on Tuesdays. On Friday night I was home with my kids.",
          "Aty pastroj vetëm të martave. Të premten natën isha në shtëpi me fëmijët.",
        ),
      },
      {
        id: "buyer",
        name: tx("Liam Ford", "Liridon Fazliu"),
        role: tx("Lives two streets away", "Banon dy rrugë më tutje"),
        statement: tx(
          "I've never been round there. I wouldn't know their dog if I saw it. I asked about the scooter online once, that's all.",
          "Nuk kam qenë kurrë atje. Qenin e tyre s'do ta njihja as po ta shihja. Për trotinetin pyeta një herë në internet, kaq.",
        ),
      },
    ],
    cards: [
      {
        id: "marketplace",
        kind: "message",
        title: tx("Marketplace message, two weeks ago", "Mesazh në internet, dy javë më parë"),
        body: tx(
          "Liam F. → Mr Morgan: “Would you sell the scooter? I can do £200.” No reply.",
          "Liridon F. → z. Kastrati: “A e shet trotinetin? Të jap 200 €.” Pa përgjigje.",
        ),
      },
      {
        id: "neighbour-note",
        kind: "report",
        title: tx("Mrs Lane, no. 6", "Zonja Lala, nr. 6"),
        body: tx(
          "Biscuit barks his head off at anyone he doesn't know. I was up all night with a cold and he didn't bark once.",
          "Murri i leh pa pushim kujtdo që s'e njeh. Isha zgjuar gjithë natën nga ftohja dhe ai nuk lehu asnjëherë.",
        ),
      },
      {
        id: "wedding-photo",
        kind: "photo",
        title: tx("Wedding photo, The Grange Hotel", "Foto nga dasma, Hotel Dukagjini"),
        body: tx(
          "Chris on the dance floor. Photo taken 01:12.",
          "Kreshniku në pistë duke vallëzuar. Foto e bërë në 01:12.",
        ),
      },
      {
        id: "walks",
        kind: "log",
        title: tx("PawPal app: Biscuit's walks", "Aplikacioni PawPal: shëtitjet e Murrit"),
        body: tx(
          "Sat 4 Nov, 10:00–10:45 · Sat 11 Nov, 10:00–10:45. Walker: Liam F. ★★★★★ “Biscuit loves him!”",
          "Sht 4 nën, 10:00–10:45 · Sht 11 nën, 10:00–10:45. Shëtitësi: Liridon F. ★★★★★ “Murri e do shumë!”",
        ),
      },
      {
        id: "rota",
        kind: "log",
        title: tx("Cleaning rota", "Orari i pastrimit"),
        body: tx(
          "Morgans: Tuesdays 9–12. Priya has a key to the garden gate.",
          "Kastrati: të martave 9–12. Pranvera ka çelës të portës së oborrit.",
        ),
      },
    ],
  },
  {
    id: "missing-mascot",
    title: tx("The Missing Mascot", "Maskota e zhdukur"),
    setting: tx("Exeter · Thursday evening", "Shkodër · e enjte në mbrëmje"),
    setup: tx(
      "The night before the school derby, someone took Oakfield School's mascot costume, a giant owl, from the sports hall store between 20:00 and 21:00. The store was opened with a key. One of these three is lying.",
      "Natën para derbit të shkollave, dikush e mori kostumin e maskotës së gjimnazit “Drita”, një buf gjigant, nga depoja e palestrës mes orës 20:00 dhe 21:00. Depoja u hap me çelës. Njëri nga këta të tre po gënjen.",
    ),
    suspects: [
      {
        id: "old-mascot",
        name: tx("Aaron Hill", "Arbër Halili"),
        role: tx("Student, last year's mascot", "Nxënës, maskota e vitit të kaluar"),
        statement: tx(
          "I was home all evening. I ordered a pizza at eight and opened the door to the delivery driver myself.",
          "Isha në shtëpi gjithë mbrëmjen. Porosita një pica në tetë dhe ia hapa derën vetë korrierit.",
        ),
      },
      {
        id: "teacher",
        name: tx("Ms Carter", "Kaltrina Çela"),
        role: tx("PE teacher", "Mësuese e edukimit fizik"),
        statement: tx(
          "I locked the hall at eight and went to my yoga class in town. It runs from quarter past eight to quarter past nine.",
          "E kyça palestrën në tetë dhe shkova në kursin e jogës në qytet. Zgjat nga tetë e një çerek deri në nëntë e një çerek.",
        ),
      },
      {
        id: "caretaker",
        name: tx("Danny Webb", "Dardan Veseli"),
        role: tx("Caretaker", "Kujdestar i shkollës"),
        statement: tx(
          "I was in the boiler room fixing the heating from half seven till ten. I never left it.",
          "Isha në kaldajë duke rregulluar ngrohjen nga shtatë e gjysmë deri në dhjetë. Nuk dola fare.",
        ),
      },
    ],
    cards: [
      {
        id: "store",
        kind: "report",
        title: tx("The store room", "Depoja"),
        body: tx(
          "No forced entry: the door was opened with a key. Keys are held by the PE department, the caretaker and the mascot. The key was never collected from last year's mascot.",
          "Nuk ka hyrje me forcë: dera u hap me çelës. Çelësat i kanë departamenti i edukimit fizik, kujdestari dhe maskota. Çelësi nuk iu mor kurrë maskotës së vitit të kaluar.",
        ),
      },
      {
        id: "yoga",
        kind: "log",
        title: tx("Yoga studio register", "Lista e kursit të jogës"),
        body: tx("Thursday, 20:15 class: … J. Carter ✓ …", "E enjte, kursi i 20:15: … K. Çela ✓ …"),
      },
      {
        id: "courier",
        kind: "report",
        title: tx("Pizza courier's note", "Shënimi i korrierit"),
        body: tx(
          "Order 4471, A. Hill, 20:31: rang three times, no answer. Left it on the doorstep.",
          "Porosia 4471, A. Halili, 20:31: i rashë ziles tri herë, s'u përgjigj askush. E lashë te pragu.",
        ),
      },
      {
        id: "team",
        kind: "notice",
        title: tx("Team notice", "Njoftim i ekipit"),
        body: tx(
          "From Friday's derby, the new mascot is Ben Ellis, replacing Aaron Hill.",
          "Që nga derbi i së premtes, maskota e re është Besnik Elezi, në vend të Arbër Halilit.",
        ),
      },
      {
        id: "boiler",
        kind: "log",
        title: tx("Boiler room job sheet", "Fleta e punës, kaldaja"),
        body: tx(
          "Heating repair: 19:35 to 21:50. Signed D. Webb.",
          "Riparim i ngrohjes: 19:35 deri 21:50. Nënshkruar D. Veseli.",
        ),
      },
    ],
  },
  {
    id: "winning-ticket",
    title: tx("The Winning Ticket", "Bileta fituese"),
    setting: tx("Cardiff · a Monday morning", "Elbasan · një të hënë në mëngjes"),
    setup: tx(
      "The office lottery syndicate's ticket won £500 in Saturday's draw. On Monday morning it was gone from the drawer where Gwen keeps the tickets. One of these three is lying.",
      "Bileta e lotarisë që e blejnë bashkë kolegët e zyrës fitoi 50.000 lekë në shortin e së shtunës. Të hënën në mëngjes, bileta s'ishte më në sirtarin ku Gentiana i ruan biletat. Njëri nga këta të tre po gënjen.",
    ),
    suspects: [
      {
        id: "colleague",
        name: tx("Tom Pryce", "Taulant Prenga"),
        role: tx("Colleague", "Koleg"),
        statement: tx(
          "I checked the numbers on Sunday night and told everyone at nine this morning. I haven't touched that drawer.",
          "I kontrollova numrat të dielën në mbrëmje dhe u thashë të gjithëve sot në nëntë. Atë sirtar nuk e kam prekur.",
        ),
      },
      {
        id: "office-cleaner",
        name: tx("Nia Evans", "Nertila Ejupi"),
        role: tx("Office cleaner", "Pastruese e zyrës"),
        statement: tx(
          "I cleaned on Saturday morning, eight till ten. I empty the bins and hoover; I never open drawers.",
          "Pastrova të shtunën në mëngjes, nga tetë deri në dhjetë. Zbraz koshat dhe fshij me fshesë elektrike; sirtarët nuk i hap kurrë.",
        ),
      },
      {
        id: "ticket-keeper",
        name: tx("Gwen Morris", "Gentiana Mema"),
        role: tx("Keeps the syndicate's tickets", "Ruan biletat e grupit"),
        statement: tx(
          "I put the ticket in my top drawer on Friday at five, like always. I had no idea we'd won until Tom told us this morning.",
          "E futa biletën në sirtarin e sipërm të premten në pesë, si gjithmonë. S'e kisha idenë që kishim fituar derisa na tha Taulanti sot në mëngjes.",
        ),
      },
    ],
    cards: [
      {
        id: "draw",
        kind: "notice",
        title: tx("Saturday's draw", "Shorti i së shtunës"),
        body: tx(
          "Numbers drawn live at 20:00 and posted online at 20:05.",
          "Numrat u hodhën drejtpërdrejt në 20:00 dhe u publikuan në internet në 20:05.",
        ),
      },
      {
        id: "office-camera",
        kind: "report",
        title: tx("Office camera", "Kamera e zyrës"),
        body: tx(
          "Saturday 10:00 to Monday 08:30: nobody entered the office.",
          "Nga e shtuna në 10:00 deri të hënën në 08:30: askush nuk hyri në zyrë.",
        ),
      },
      {
        id: "lottery-app",
        kind: "log",
        title: tx("Tom's lottery app", "Aplikacioni i lotarisë i Taulantit"),
        body: tx("Results checked: Sunday 21:40.", "Rezultatet u kontrolluan: e diel, 21:40."),
      },
      {
        id: "cleaning-log",
        kind: "log",
        title: tx("Cleaning log", "Regjistri i pastrimit"),
        body: tx(
          "Saturday: in 08:02, out 09:58. Nia's key ring opens every desk drawer.",
          "E shtunë: hyrja 08:02, dalja 09:58. Tufa e çelësave të Nertilës hap çdo sirtar.",
        ),
      },
      {
        id: "keeper-text",
        kind: "message",
        title: tx("Gwen → her sister, Saturday 20:15", "Gentiana → motrës, e shtunë 20:15"),
        body: tx(
          "OMG WE WON 😱😱 Don't tell anyone yet, I need to think.",
          "O ZOT, FITUAM 😱😱 Mos i thuaj askujt ende, duhet të mendohem.",
        ),
      },
    ],
  },
];
