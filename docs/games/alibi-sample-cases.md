# Alibi: case format and three sample cases

This is the first step from [daily-mystery-prompt.md](daily-mystery-prompt.md): the
data format and three cases to read before any code is written.

## The rule the player is told

> **One of them is lying. Find the lie, and the card that proves it.**

Every case has exactly one statement that a card contradicts. The culprit is the
person who made it. The other two statements fit every card, even when those people
have a motive or look suspicious.

## Each language gets its own world

The English case is set in England, with English names, places and pounds. The
Albanian case is set in Kosovo or Albania, with Albanian names, places and euros. The
story, the times, the clues and the answer are the same in both. Only the world
around them changes, so neither version reads like a translation.

## The data format

The case text is in `src/lib/games/alibi-bank.ts`. The answers are in
`src/lib/games/alibi-answers.ts`, which the game loads only when a run starts, and
the database keeps its own copy of each culprit and proof to check scores.

```ts
/** English and Albanian side by side, so a case is reviewed and checked as one unit. */
type Text = { readonly en: string; readonly sq: string };

type CardKind = "log" | "message" | "receipt" | "notice" | "report" | "photo";

type Suspect = {
  readonly id: string; // "cleaner": a role, the same in both languages
  readonly name: Text; // "Dan Carter" / "Driton Krasniqi"
  readonly role: Text; // "Cleaner" / "Pastrues"
  readonly statement: Text; // 2–4 short sentences
  readonly statedAt?: Text; // when it matters: "Statement taken at 10:30"
};

type Card = {
  readonly id: string; // "back-door"
  readonly kind: CardKind; // picks the card's look: a log, a text bubble, a receipt…
  readonly title: Text; // "Back door: staff key cards, Saturday"
  readonly body: Text; // at most ~40 words, so it reads on a phone
};

/** Public, in the client's bank (src/lib/games/alibi-bank.ts). */
type AlibiCase = {
  readonly id: string; // stable slug; only ever append new cases
  readonly title: Text;
  readonly setting: Text; // "Bristol · Saturday afternoon" / "Prishtinë · e shtunë pasdite"
  readonly setup: Text; // what happened, the time window, "one of them is lying"
  readonly suspects: readonly [Suspect, Suspect, Suspect];
  readonly cards: readonly Card[]; // 4–6
};

/** In src/lib/games/alibi-answers.ts, by the same index as the case. */
type AlibiAnswer = {
  readonly culprit: number; // the suspect whose statement is false: their place in the list
  readonly proof: number; // the card that contradicts it: its place in the list
  readonly solution: Text; // the reveal, shown when the run ends
};
```

Suspect IDs are roles (`cleaner`, `best-man`), not names, because the names differ
between languages while the answer must not.

**Where the answers live (changed while building).** The first plan kept the
answers only in the database. That doesn't fit how Unbored's daily games work: the
browser scores the run itself and the database replays it to check, so the game
needs the answer to tell a player "wrong, one accusation left" mid-run, and so do
Unlimited, the archive and offline play. Keeping answers server-side would mean new
API routes and losing those modes. So Alibi does what every other daily game does
(Ton Up, Ballpark, Only Once, Dead Reckoning…): the answers reach the browser, in a
separate file loaded only when a run starts, so they aren't sitting next to the case
text. A determined player could read them, as they could for any other daily game;
the database still checks every score. `scripts/generate-daily-banks.ts` writes each
case's file count, culprit and proof into the migration, and the tests fail if the
two copies drift.

**The checker** (runs in the tests, over the whole bank) fails a case when:

- it doesn't have exactly 3 suspects and 4–6 cards;
- the answer's culprit or proof card doesn't exist in the case;
- either language is missing for any text;
- a statement is over 4 sentences or a card body is over ~40 words;
- in either language, the proof card doesn't share a time, name or detail with the
  culprit's statement (a rough check that the contradiction is actually there);
- the times in the two languages differ (every `HH:MM` in the English text must also
  appear in the Albanian, so the clues can't drift apart);
- two cases share an ID.

Whether a case is _fair_ (exactly one lie, no second reading) can't be checked by
code. That's what the human review is for.

## Scoring (as built)

- A solve starts at **1,000**.
- **−80** for every card opened (the setup and statements are free).
- **−300** for a wrong accusation. After 2 misses the case closes with 0.
- The best possible day is **920**: only the proof opened, right first time.
- **Stars:** ★★★ solved first try having opened at most half the cards ·
  ★★ solved first try · ★ solved on the second try.
- **No clock.** The time bonus in the first plan was dropped: the server can't check
  how long a player took, so it would only reward people who fake it.

---

## Case 1: The Tip Jar / Kavanoza e bakshishit

_Contradiction type: a log puts someone somewhere they say they weren't._

|                  | English                      | Shqip                        |
| ---------------- | ---------------------------- | ---------------------------- |
| Setting          | Bristol · Saturday afternoon | Prishtinë · e shtunë pasdite |
| Place            | The Corner Café              | Kafja e Qoshes               |
| Barista          | Amy Brooks                   | Arta Berisha                 |
| Regular customer | Ben Hughes                   | Blerim Hoxha                 |
| Cleaner          | Dan Carter                   | Driton Krasniqi              |
| Money            | £                            | €                            |

**Setup**

> Saturday afternoon at the Corner Café in Bristol. The tip jar on the counter, about
> £60, vanished sometime between 15:30 and 15:48. Three people could have taken it.
> One of them is lying.

> E shtunë pasdite në Kafen e Qoshes, në Prishtinë. Kavanoza e bakshishit mbi banak,
> rreth 60 €, u zhduk diku mes orës 15:30 dhe 15:48. Tre persona mund ta kenë marrë.
> Njëri prej tyre po gënjen.

### Suspects

**Amy Brooks**, Barista / **Arta Berisha**, Banakiere

> I took my break at three, out the back door. When I came back at half past, the
> jar was still there. I made two coffees, turned round, and it was gone.

> Pushimin e mora në ora tre, dola nga dera e pasme. Kur u ktheva në tre e gjysmë,
> kavanoza ishte ende aty. Bëra dy kafe, u ktheva dhe ajo s'ishte më.

**Ben Hughes**, Regular customer, writer / **Blerim Hoxha**, Klient i rregullt, shkrimtar

> I sat at my window table from two until five, writing. I only went to the
> counter when I left, to pay.

> Ndenja në tavolinën time pranë dritares nga ora dy deri në pesë, duke shkruar.
> Te banaku shkova vetëm kur ika, për të paguar.

**Dan Carter**, Cleaner / **Driton Krasniqi**, Pastrues

> My shift starts at half four. I came in through the back at 16:30 and Amy told me
> straight away the jar was gone. I wasn't anywhere near the café before that.

> Turni im fillon në katër e gjysmë. Hyra nga dera e pasme në 16:30 dhe Arta më tha
> menjëherë që kavanoza ishte zhdukur. Para kësaj nuk isha fare afër kafenesë.

### Cards

1. **message · Amy → the manager, 15:48 / Arta → menaxheri, 15:48**

   > Tip jar's gone 😡 It was there at 15:30 when I got back from break. I swear I
   > only turned my back for a minute.

   > Kavanoza e bakshishit u zhduk 😡 Ishte aty në 15:30 kur u ktheva nga pushimi.
   > Të betohem, vetëm për një minutë ia ktheva shpinën.

2. **log · Back door: staff key cards, Saturday / Dera e pasme: kartelat e stafit, e shtunë** ← _proof_

   > 15:29 Amy B. · 15:36 Dan C. · 16:31 Dan C.
   > Each staff member has their own card. The front door has no card reader.

   > 15:29 Arta B. · 15:36 Driton K. · 16:31 Driton K.
   > Çdo punonjës ka kartelën e vet. Dera e përparme nuk ka lexues kartelash.

3. **report · Front camera, 15:30–15:48 / Kamera e përparme, 15:30–15:48**

   > The camera faces the street door. No one enters or leaves through the front in
   > that time.

   > Kamera sheh nga dera e rrugës. Askush nuk hyn e as del nga përpara gjatë kësaj
   > kohe.

4. **photo · Found under Ben's table / Gjetur nën tavolinën e Blerimit**

   > A sticky note: "RENT due Monday: £350!!"

   > Një letër ngjitëse: "QIRAJA të hënën: 350 €!!"

5. **receipt · Till receipt, 17:02 / Fatura, 17:02**

   > Table 4 (window): 3 × flat white, 1 × water, £11.40. Paid by card, B. Hughes.

   > Tavolina 4 (dritarja): 3 × makiato, 1 × ujë, 4,80 €. Paguar me kartelë, B. Hoxha.

### Answer

**Culprit:** the cleaner · **Proof:** card 2, the back door log

> Dan says he wasn't near the café before 16:30, but his own key card opened the
> back door at 15:36, six minutes after Amy came back and twelve before she noticed
> the jar was gone. He slipped in, took the jar while Amy was busy at the machine,
> left the way he came, and walked in an hour later as if for the first time.

> Driton thotë se nuk ishte afër kafenesë para orës 16:30, por kartela e tij e hapi
> derën e pasme në 15:36, gjashtë minuta pasi u kthye Arta dhe dymbëdhjetë minuta para
> se ajo ta vinte re që kavanoza mungonte. Hyri fshehurazi, e mori kavanozën ndërsa
> Arta ishte e zënë te makina e kafesë, doli nga ku kishte hyrë dhe një orë më vonë
> hyri sërish sikur të ishte hera e parë.

**Red herring:** the customer's rent note gives him a motive, but nothing he said is
contradicted.

---

## Case 2: A Slice Too Soon / Një fetë para kohe

_Contradiction type: a notice makes someone's alibi impossible._

|                         | English                      | Shqip                         |
| ----------------------- | ---------------------------- | ----------------------------- |
| Setting                 | Brighton · a wedding morning | Durrës · mëngjesi i një dasme |
| Place                   | The Bayview Hotel            | Hotel Adriatik                |
| The bride's cousin      | Chloe Harris                 | Klea Hasani                   |
| Pastry chef             | Eric Dawson                  | Ermal Dushi                   |
| The groom's best friend | Gary Lewis                   | Genti Leka                    |
| Salon                   | Belle Hair                   | Sallon Bukuria                |
| Money                   | £                            | €                             |

**Setup**

> The Bayview Hotel, Brighton, on a wedding day. The cake for the 13:00 reception was
> finished at 9:30 and put in the kitchen's walk-in fridge. At noon someone noticed a
> large slice was already missing. One of these three is lying.

> Hotel Adriatik, Durrës, ditë dasme. Torta për pritjen e orës 13:00 u përfundua në
> 9:30 dhe u vendos në frigoriferin e madh të kuzhinës. Në mesditë dikush vuri re që
> mungonte tashmë një fetë e madhe. Njëri nga këta të tre po gënjen.

### Suspects

**Chloe Harris**, The bride's cousin / **Klea Hasani**, Kushërira e nuses

> I was at the hairdresser in town from ten until twelve. Look at this hair. Do you
> think that took ten minutes?

> Isha te parukeria në qytet nga ora dhjetë deri në dymbëdhjetë. Shiko këto flokë.
> Mendon se u bënë për dhjetë minuta?

**Eric Dawson**, Pastry chef / **Ermal Dushi**, Pastiçier

> I finished the cake at half nine, put it in the walk-in and went home to sleep. I
> didn't come back until half twelve.

> E mbarova tortën në nëntë e gjysmë, e futa në frigorifer dhe shkova në shtëpi të
> fle. U ktheva vetëm në dymbëdhjetë e gjysmë.

**Gary Lewis**, The groom's best friend / **Genti Leka**, Shoku i ngushtë i dhëndrit

> I spent the whole morning at the pool bar practising my speech. Ask the waiter, I
> had three coffees.

> Gjithë mëngjesin e kalova te bari i pishinës duke e ushtruar fjalimin. Pyete
> kamarierin, piva tri kafe.

### Cards

1. **notice · Sign at reception / Njoftim në recepsion** ← _proof_

   > The pool and pool bar are CLOSED today, 08:00–13:00, for cleaning. We apologise
   > for the inconvenience.

   > Pishina dhe bari i pishinës janë të MBYLLURA sot, 08:00–13:00, për pastrim. Na
   > falni për shqetësimin.

2. **receipt · Belle Hair / Sallon Bukuria**

   > Chloe H.: updo and make-up, 10:05 to 11:50. £85, paid cash.

   > Klea H.: model flokësh dhe grim, 10:05 deri 11:50. 45 €, paguar me para në dorë.

3. **log · Walk-in fridge door / Dera e frigoriferit**

   > 09:31 pastry code · 11:14 master key · 12:02 kitchen code

   > 09:31 kodi i pastiçerisë · 11:14 çelësi kryesor · 12:02 kodi i kuzhinës

4. **report · Front desk book / Libri i recepsionit**

   > 11:05: master kitchen key lent to "the wedding party, to put drinks in the
   > fridge". Returned 11:20. Signature unreadable.

   > 11:05: çelësi kryesor i kuzhinës iu dha "dasmorëve, për të futur pijet në
   > frigorifer". U kthye në 11:20. Nënshkrimi nuk lexohet.

5. **message · Eric → a friend, 08:10 / Ermali → një shoku, 08:10**

   > They're paying me half what this cake is worth. Never again.

   > Po më paguajnë gjysmën e asaj që vlen kjo tortë. Kurrë më.

6. **report · Housekeeping, 11:40 / Pastrimi, 11:40**

   > Buttercream fingerprints on the second-floor corridor railing. Rooms on that
   > floor include 204 (Chloe H.) and 207 (G. Lewis).

   > Gjurmë gishtash me krem gjalpi në parmakun e korridorit të katit të dytë. Në atë
   > kat janë edhe dhomat 204 (Klea H.) dhe 207 (G. Leka).

### Answer

**Culprit:** the best friend · **Proof:** card 1, the sign at reception

> Gary says he spent the morning at the pool bar, but the pool and its bar were
> closed until 13:00. With no alibi, he borrowed the kitchen key at 11:05 "for the
> drinks", opened the fridge at 11:14 and helped himself. The buttercream on the
> second-floor railing was left on his way back to room 207.

> Genti thotë se e kaloi mëngjesin te bari i pishinës, por pishina dhe bari ishin të
> mbyllura deri në 13:00. Pa alibi, ai e mori hua çelësin e kuzhinës në 11:05 "për
> pijet", e hapi frigoriferin në 11:14 dhe preu një fetë. Kremi në parmakun e katit të
> dytë mbeti rrugës për në dhomën 207.

**Red herrings:** the pastry chef's grumpy message gives him a motive. The
fingerprints point at both the cousin's and the best friend's floor, but the cousin
was at the salon until 11:50.

---

## Case 3: The Prize Marrow / Kungulli fitues

_Contradiction type: someone knows a detail they couldn't have known._

|                 | English                                         | Shqip                                          |
| --------------- | ----------------------------------------------- | ---------------------------------------------- |
| Setting         | Little Hadley · the morning of the village show | Dardhë, Korçë · mëngjesi i panairit të fshatit |
| The grandmother | Mrs Pell                                        | zonja Prifti                                   |
| Rival grower    | Colin Barnes                                    | Kolë Bardhi                                    |
| Show secretary  | Judith Reyes                                    | Jeta Rama                                      |
| The grandson    | Tom Pell                                        | Toni Prifti                                    |
| Police officer  | PC Dodd                                         | polici Dedaj                                   |
| Quiz venue      | the Fox pub                                     | kafe-bari Dhelpra                              |

**Setup**

> Little Hadley's village show. On judging morning, Mrs Pell's giant marrow, the
> favourite to win for the fourth year running, was found smashed in the produce tent.
> The tent was locked from 20:00 the night before until 07:00. One of these three is
> lying.

> Panairi i fshatit në Dardhë. Në mëngjesin e vlerësimit, kungulli gjigant i zonjës
> Prifti, favorit për të fituar për të katërtin vit radhazi, u gjet i copëtuar në
> tendën e prodhimeve. Tenda ishte e kyçur nga ora 20:00 e mbrëmjes deri në 07:00.
> Njëri nga këta të tre po gënjen.

### Suspects

**Colin Barnes**, Rival grower / **Kolë Bardhi**, Kultivues rival

> I was at the pub quiz at the Fox until eleven, then straight home to bed. I heard
> about it at eight this morning like everyone else.

> Isha në kuizin e kafe-barit Dhelpra deri në njëmbëdhjetë, pastaj drejt e në shtëpi
> për të fjetur. Mora vesh në tetë të mëngjesit, si gjithë të tjerët.

**Judith Reyes**, Show secretary / **Jeta Rama**, Sekretarja e panairit

> I locked the tent at eight and took the key home. When I opened up at seven this
> morning, the marrow was already in pieces.

> E kyça tendën në tetë dhe e mora çelësin në shtëpi. Kur e hapa në shtatë të
> mëngjesit, kungulli ishte tashmë copa-copa.

**Tom Pell**, Mrs Pell's grandson / **Toni Prifti**, Nipi i zonjës Prifti
_Statement taken at 10:30 / Deklarata u mor në 10:30_

> Gran rang me in tears at half seven. All I know is what she told me. Who smashes a
> prize marrow with a garden spade? It's unbelievable.

> Gjyshja më mori në telefon duke qarë në shtatë e gjysmë. Di vetëm atë që më tha
> ajo. Kush e copëton një kungull fitues me lopatë kopshti? Është e pabesueshme.

### Cards

1. **report · PC Dodd's notebook / Blloku i policit Dedaj** ← _proof_

   > 09:10: Found a garden spade with a cracked handle hidden behind the tent. The
   > weapon is NOT to be mentioned to anyone until further notice.

   > 09:10: Gjeta një lopatë kopshti me bisht të plasaritur, të fshehur pas tendës.
   > Për armën të mos i thuhet ASKUJT deri në njoftim të dytë.

2. **receipt · The Fox, quiz night / Kafe-bari Dhelpra, mbrëmja e kuizit**

   > Team "Marrow Kings" (C. Barnes + 3): 2nd place. Quiz ended 22:55.

   > Ekipi "Mbretërit e Kungujve" (K. Bardhi + 3): vendi i 2-të. Kuizi mbaroi në 22:55.

3. **notice · Show results, last three years / Rezultatet e panairit, tri vitet e fundit**

   > Giant Marrow class. 1st: Mrs E. Pell · 2nd: C. Barnes (all three years).

   > Kategoria Kungulli Gjigant. 1: zonja L. Prifti · 2: K. Bardhi (të tri vitet).

4. **report · The tent at 07:00 / Tenda në 07:00**

   > Padlock undamaged. One side of the tent had its ties undone. Anyone could have
   > crawled in.

   > Dryni i padëmtuar. Njëra anë e tendës ishte zgjidhur nga lidhëset. Kushdo mund të
   > hynte zvarrë.

5. **message · Judith's diary / Ditari i Jetës**

   > Mrs P. complained about how I run the show AGAIN. Insufferable woman.

   > Zonja P. u ankua SËRISH për mënyrën si e organizoj panairin. Grua e padurueshme.

6. **message · Tom → a friend, 19:40 the night before / Toni → një shoku, 19:40 mbrëmjen e kaluar**

   > If Gran wins again she'll make me drive her to the county show. Three days in a
   > tent. Not happening.

   > Nëse fiton prapë gjyshja, do më detyrojë ta çoj në panairin e qarkut. Tri ditë në
   > tendë. S'ka shans.

### Answer

**Culprit:** the grandson · **Proof:** card 1, the police officer's notebook

> Tom says all he knows is what Gran told him at half seven, yet he knew the marrow
> was smashed with a garden spade. The spade wasn't found until 09:10, and the police
> told no one about it. The only way Tom could know is that he used it.

> Toni thotë se di vetëm atë që i tha gjyshja në shtatë e gjysmë, por e dinte që
> kungulli ishte copëtuar me lopatë kopshti. Lopata u gjet vetëm në 09:10 dhe policia
> nuk ia tregoi askujt. E vetmja mënyrë si mund ta dinte Toni është se e kishte
> përdorur vetë.

**Red herrings:** the rival grower has lost to the grandmother three years running,
and the secretary has the key and a grudge. Neither statement is contradicted by any
card: the quiz ending at 22:55 fits "until eleven".

---

## What to look at when you review

- **Is each case fair?** Could you argue a second suspect is lying? If so, the case
  needs fixing before the format is final.
- **Is it the right difficulty?** Case 1 is the easiest, case 3 the hardest. A good
  daily bank mixes all three types of contradiction.
- **Do both versions read naturally?** The English should feel English and the
  Albanian Albanian. Fix anything that sounds translated.
- **Length:** reading everything takes about 2 minutes, which leaves 1–3 minutes to
  think. Is that the right size?
