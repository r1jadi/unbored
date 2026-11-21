/**
 * Alibi's answers: for each case in `alibi-bank.ts`, by the same index, who is
 * lying, the card that proves it, and the reveal shown when the run ends.
 *
 * The runtime imports this module only when a run starts, so the answers are not
 * in the code that draws the catalogue or the case itself. That keeps them out of
 * casual sight, not out of reach: like every daily game's bank, they reach the
 * browser, and a determined player could read them. The score is still decided by
 * the database, which holds the same culprit and card in `public.alibi_case`
 * (written by `bun scripts/generate-daily-banks.ts --write`).
 */

import type { Text } from "@/lib/games/alibi-bank";

export type AlibiAnswer = {
  /** The suspect whose statement is false: their place in the case's list. */
  readonly culprit: number;
  /** The card that contradicts it: its place in the case's list. */
  readonly proof: number;
  readonly solution: Text;
};

const tx = (en: string, sq: string): Text => ({ en, sq });

export const ALIBI_ANSWERS: readonly AlibiAnswer[] = [
  {
    // The Tip Jar: the cleaner, by the back door log.
    culprit: 2,
    proof: 1,
    solution: tx(
      "Dan says he wasn't near the café before 16:30, but his own key card opened the back door at 15:36, six minutes after Amy came back and twelve before she noticed the jar was gone. He slipped in, took the jar while Amy was busy at the machine, left the way he came, and walked in an hour later as if for the first time.",
      "Driton thotë se nuk ishte afër kafenesë para orës 16:30, por kartela e tij e hapi derën e pasme në 15:36, gjashtë minuta pasi u kthye Arta dhe dymbëdhjetë minuta para se ajo ta vinte re që kavanoza mungonte. Hyri fshehurazi, e mori kavanozën ndërsa Arta ishte e zënë te makina e kafesë, doli nga ku kishte hyrë dhe një orë më vonë hyri sërish sikur të ishte hera e parë.",
    ),
  },
  {
    // A Slice Too Soon: the best friend, by the sign at reception.
    culprit: 2,
    proof: 0,
    solution: tx(
      "Gary says he spent the morning at the pool bar, but the pool and its bar were closed until 13:00. With no alibi, he borrowed the kitchen key at 11:05 “for the drinks”, opened the fridge at 11:14 and helped himself. The buttercream on the second-floor railing was left on his way back to room 207.",
      "Genti thotë se e kaloi mëngjesin te bari i pishinës, por pishina dhe bari ishin të mbyllura deri në 13:00. Pa alibi, ai e mori hua çelësin e kuzhinës në 11:05 “për pijet”, e hapi frigoriferin në 11:14 dhe preu një fetë. Kremi në parmakun e katit të dytë mbeti rrugës për në dhomën 207.",
    ),
  },
  {
    // The Prize Marrow: the grandson, by the police officer's notebook.
    culprit: 2,
    proof: 0,
    solution: tx(
      "Tom says all he knows is what Gran told him at half seven, yet he knew the marrow was smashed with a garden spade. The spade wasn't found until 09:10, and the police told no one about it. The only way Tom could know is that he used it.",
      "Toni thotë se di vetëm atë që i tha gjyshja në shtatë e gjysmë, por e dinte që kungulli ishte copëtuar me lopatë kopshti. Lopata u gjet vetëm në 09:10 dhe policia nuk ia tregoi askujt. E vetmja mënyrë si mund ta dinte Toni është se e kishte përdorur vetë.",
    ),
  },
  {
    // The Cut Roses: the jogger, by the weather station.
    culprit: 0,
    proof: 1,
    solution: tx(
      "Sam says it was a lovely dry morning when he ran at six, but the weather station recorded heavy rain from 04:00 to 07:00. He wasn't out for a run. He was out with the secateurs, and made up the run to explain being outside so early.",
      "Samiu thotë se në gjashtë, kur doli për vrap, ishte mëngjes i thatë, por stacioni meteorologjik regjistroi shi të dendur nga 04:00 deri në 07:00. Ai nuk kishte dalë për vrap. Kishte dalë me gërshërët, dhe vrapin e shpiku për të shpjeguar pse ishte jashtë kaq herët.",
    ),
  },
  {
    // The Deleted Pitch: the intern, by the badge log.
    culprit: 1,
    proof: 3,
    solution: tx(
      "Oliver says he left at half nine on the dot to catch the 21:40 bus, but his badge only let him out at 21:58, eleven minutes after the pitch was deleted from the shared desk. He was still in the office, and it was empty, just as he said.",
      "Olsi thotë se iku fiks në nëntë e gjysmë për autobusin e 21:40, por kartela e tij e nxori jashtë vetëm në 21:58, njëmbëdhjetë minuta pasi prezantimi u fshi nga tavolina e përbashkët. Ai ishte ende në zyrë, dhe zyra ishte bosh, ashtu si tha vetë.",
    ),
  },
  {
    // The Midnight Feast: the camper who "never woke", by her fitness band.
    culprit: 1,
    proof: 4,
    solution: tx(
      "Mia says she didn't wake once until the breakfast bell, but her own fitness band shows her awake from 00:58 to 01:31, walking 1,412 steps, far more than a trip to the toilets, which didn't open then anyway. That's a walk to the kitchen for the key, and on to the shop.",
      "Mira thotë se nuk u zgjua asnjëherë deri te zilja e mëngjesit, por byzylyku i saj tregon se ishte zgjuar nga 00:58 deri në 01:31 dhe bëri 1.412 hapa, shumë më tepër se një shkuarje te banjat, që në atë kohë as nuk u hapën. Ishte rruga deri te kuzhina për çelësin, e pastaj te dyqani.",
    ),
  },
  {
    // The Broken Window: the witness, by the almanac.
    culprit: 0,
    proof: 2,
    solution: tx(
      "Nora says she saw the boy's face clear as day in the evening sun, but on 12 December the sun set at 15:50, and with the lamps out the High Street was pitch dark at 19:45. She couldn't have seen anyone's face. She invented the boy in the red hoodie to hide that she threw the stone herself, after her complaints went nowhere.",
      "Nora thotë se ia pa fytyrën djalit qartë në diellin e mbrëmjes, por më 12 dhjetor dielli perëndoi në 15:50, dhe me llambat e fikura rruga kryesore ishte krejt e errët në 19:45. Ajo nuk mund të shihte fytyrën e askujt. Djalin me duks të kuq e shpiku për të fshehur se gurin e hodhi vetë, pasi ankesat e saj nuk dhanë rezultat.",
    ),
  },
  {
    // The Dog That Didn't Bark: the buyer, by the dog-walking app.
    culprit: 2,
    proof: 3,
    solution: tx(
      "Liam says he's never been round and wouldn't know Biscuit if he saw him, but the PawPal app shows he walked Biscuit twice this month, and Biscuit loves him. That's why the dog stayed quiet: the thief was a friend.",
      "Liridoni thotë se nuk ka qenë kurrë atje dhe se Murrin s'do ta njihte, por aplikacioni PawPal tregon se e ka shëtitur Murrin dy herë këtë muaj, dhe Murri e do shumë. Prandaj qeni nuk lehu: hajni ishte mik i tij.",
    ),
  },
  {
    // The Missing Mascot: last year's mascot, by the courier's note.
    culprit: 0,
    proof: 2,
    solution: tx(
      "Aaron says he opened the door to the pizza driver himself, but the courier rang three times at 20:31, got no answer and left the pizza on the doorstep. Aaron wasn't home. Still holding last year's key and angry at being replaced, he was at the sports hall taking back the owl.",
      "Arbri thotë se ia hapi derën vetë korrierit, por korrieri i ra ziles tri herë në 20:31, nuk u përgjigj askush dhe e la picën te pragu. Arbri nuk ishte në shtëpi. Me çelësin e vitit të kaluar ende në xhep dhe i zemëruar që e zëvendësuan, ai ishte në palestër duke e marrë bufin.",
    ),
  },
  {
    // The Winning Ticket: the ticket keeper, by her text to her sister.
    culprit: 2,
    proof: 4,
    solution: tx(
      "Gwen says she had no idea they'd won until Monday, but at 20:15 on Saturday, ten minutes after the numbers went online, she texted her sister “WE WON”. Nobody entered the office after Saturday morning, so the ticket never went into the drawer: Gwen took it home on Friday, and when it won, she kept it.",
      "Gentiana thotë se nuk e dinte që kishin fituar deri të hënën, por të shtunën në 20:15, dhjetë minuta pasi numrat dolën në internet, i shkroi motrës “FITUAM”. Askush nuk hyri në zyrë pas të shtunës në mëngjes, kështu që bileta s'u fut kurrë në sirtar: Gentiana e mori në shtëpi të premten, dhe kur fitoi, e mbajti për vete.",
    ),
  },
];
