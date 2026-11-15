/**
 * Ton Up's categories: every answer a dart can name, and the number it is worth.
 *
 * Day `d` plays category `d mod n`. Only the values reach the database —
 * `public.ton_up_values` in `supabase/migrations/20270104120000_ton_up_sessions.sql`
 * holds each category's values in this order, and `ton-up.test.ts` asserts that the
 * two copies match. Rewrite the migration's lists with
 * `bun scripts/generate-daily-banks.ts --write` after changing anything here.
 *
 * An answer's place in its list is its id: never reorder or remove one, only add
 * at the end (and only under a new rules version, since old runs name ids).
 */

export type TonUpAnswer = {
  readonly name: string;
  readonly value: number;
  /** Other names a player may type for it. */
  readonly aliases?: readonly string[];
};

export type TonUpCategory = {
  readonly title: string;
  /** What a value means, for the board: "atomic number". */
  readonly unit: string;
  readonly source: string;
  readonly answers: readonly TonUpAnswer[];
};

const ELEMENTS = [
  "Hydrogen", "Helium", "Lithium", "Beryllium", "Boron", "Carbon", "Nitrogen", "Oxygen",
  "Fluorine", "Neon", "Sodium", "Magnesium", "Aluminium", "Silicon", "Phosphorus", "Sulfur",
  "Chlorine", "Argon", "Potassium", "Calcium", "Scandium", "Titanium", "Vanadium", "Chromium",
  "Manganese", "Iron", "Cobalt", "Nickel", "Copper", "Zinc", "Gallium", "Germanium", "Arsenic",
  "Selenium", "Bromine", "Krypton", "Rubidium", "Strontium", "Yttrium", "Zirconium", "Niobium",
  "Molybdenum", "Technetium", "Ruthenium", "Rhodium", "Palladium", "Silver", "Cadmium",
  "Indium", "Tin", "Antimony", "Tellurium", "Iodine", "Xenon", "Caesium", "Barium",
  "Lanthanum", "Cerium", "Praseodymium", "Neodymium", "Promethium", "Samarium", "Europium",
  "Gadolinium", "Terbium", "Dysprosium", "Holmium", "Erbium", "Thulium", "Ytterbium",
  "Lutetium", "Hafnium", "Tantalum", "Tungsten", "Rhenium", "Osmium", "Iridium", "Platinum",
  "Gold", "Mercury", "Thallium", "Lead", "Bismuth", "Polonium", "Astatine", "Radon",
  "Francium", "Radium", "Actinium", "Thorium", "Protactinium", "Uranium", "Neptunium",
  "Plutonium", "Americium", "Curium", "Berkelium", "Californium", "Einsteinium", "Fermium",
  "Mendelevium", "Nobelium", "Lawrencium", "Rutherfordium", "Dubnium", "Seaborgium", "Bohrium",
  "Hassium", "Meitnerium", "Darmstadtium", "Roentgenium", "Copernicium", "Nihonium",
  "Flerovium", "Moscovium", "Livermorium", "Tennessine", "Oganesson",
]; // prettier-ignore

const ELEMENT_ALIASES: Record<string, readonly string[]> = {
  Aluminium: ["Aluminum"],
  Sulfur: ["Sulphur"],
  Caesium: ["Cesium"],
};

const PRESIDENTS = [
  "George Washington", "John Adams", "Thomas Jefferson", "James Madison", "James Monroe",
  "John Quincy Adams", "Andrew Jackson", "Martin Van Buren", "William Henry Harrison",
  "John Tyler", "James K. Polk", "Zachary Taylor", "Millard Fillmore", "Franklin Pierce",
  "James Buchanan", "Abraham Lincoln", "Andrew Johnson", "Ulysses S. Grant",
  "Rutherford B. Hayes", "James A. Garfield", "Chester A. Arthur", "Grover Cleveland (first term)",
  "Benjamin Harrison", "Grover Cleveland (second term)", "William McKinley",
  "Theodore Roosevelt", "William Howard Taft", "Woodrow Wilson", "Warren G. Harding",
  "Calvin Coolidge", "Herbert Hoover", "Franklin D. Roosevelt", "Harry S. Truman",
  "Dwight D. Eisenhower", "John F. Kennedy", "Lyndon B. Johnson", "Richard Nixon",
  "Gerald Ford", "Jimmy Carter", "Ronald Reagan", "George H. W. Bush", "Bill Clinton",
  "George W. Bush", "Barack Obama", "Donald Trump (first term)", "Joe Biden",
  "Donald Trump (second term)",
]; // prettier-ignore

const PRESIDENT_ALIASES: Record<string, readonly string[]> = {
  "Franklin D. Roosevelt": ["FDR"],
  "John F. Kennedy": ["JFK"],
  "Lyndon B. Johnson": ["LBJ"],
  "Theodore Roosevelt": ["Teddy Roosevelt"],
  "Ulysses S. Grant": ["Ulysses Grant"],
  "Dwight D. Eisenhower": ["Ike"],
};

const STATES = [
  "Delaware", "Pennsylvania", "New Jersey", "Georgia", "Connecticut", "Massachusetts",
  "Maryland", "South Carolina", "New Hampshire", "Virginia", "New York", "North Carolina",
  "Rhode Island", "Vermont", "Kentucky", "Tennessee", "Ohio", "Louisiana", "Indiana",
  "Mississippi", "Illinois", "Alabama", "Maine", "Missouri", "Arkansas", "Michigan", "Florida",
  "Texas", "Iowa", "Wisconsin", "California", "Minnesota", "Oregon", "Kansas", "West Virginia",
  "Nevada", "Nebraska", "Colorado", "North Dakota", "South Dakota", "Montana", "Washington",
  "Idaho", "Wyoming", "Utah", "Oklahoma", "New Mexico", "Arizona", "Alaska", "Hawaii",
]; // prettier-ignore

const CALLING_CODES: readonly TonUpAnswer[] = [
  { name: "United States", value: 1, aliases: ["USA", "US", "America"] },
  { name: "Canada", value: 1 },
  { name: "Russia", value: 7 },
  { name: "Kazakhstan", value: 7 },
  { name: "Egypt", value: 20 },
  { name: "South Africa", value: 27 },
  { name: "Greece", value: 30 },
  { name: "Netherlands", value: 31, aliases: ["Holland"] },
  { name: "Belgium", value: 32 },
  { name: "France", value: 33 },
  { name: "Spain", value: 34 },
  { name: "Hungary", value: 36 },
  { name: "Italy", value: 39 },
  { name: "Romania", value: 40 },
  { name: "Switzerland", value: 41 },
  { name: "Austria", value: 43 },
  { name: "United Kingdom", value: 44, aliases: ["UK", "Britain", "Great Britain"] },
  { name: "Denmark", value: 45 },
  { name: "Sweden", value: 46 },
  { name: "Norway", value: 47 },
  { name: "Poland", value: 48 },
  { name: "Germany", value: 49 },
  { name: "Peru", value: 51 },
  { name: "Mexico", value: 52 },
  { name: "Cuba", value: 53 },
  { name: "Argentina", value: 54 },
  { name: "Brazil", value: 55 },
  { name: "Chile", value: 56 },
  { name: "Colombia", value: 57 },
  { name: "Venezuela", value: 58 },
  { name: "Malaysia", value: 60 },
  { name: "Australia", value: 61 },
  { name: "Indonesia", value: 62 },
  { name: "Philippines", value: 63 },
  { name: "New Zealand", value: 64 },
  { name: "Singapore", value: 65 },
  { name: "Thailand", value: 66 },
  { name: "Japan", value: 81 },
  { name: "South Korea", value: 82, aliases: ["Korea"] },
  { name: "Vietnam", value: 84 },
  { name: "China", value: 86 },
  { name: "Turkey", value: 90, aliases: ["Türkiye"] },
  { name: "India", value: 91 },
  { name: "Pakistan", value: 92 },
  { name: "Afghanistan", value: 93 },
  { name: "Sri Lanka", value: 94 },
  { name: "Myanmar", value: 95, aliases: ["Burma"] },
  { name: "Iran", value: 98 },
  { name: "Morocco", value: 212 },
  { name: "Ghana", value: 233 },
  { name: "Nigeria", value: 234 },
  { name: "Ethiopia", value: 251 },
  { name: "Kenya", value: 254 },
  { name: "Portugal", value: 351 },
  { name: "Luxembourg", value: 352 },
  { name: "Ireland", value: 353 },
  { name: "Iceland", value: 354 },
  { name: "Albania", value: 355 },
  { name: "Finland", value: 358 },
  { name: "Bulgaria", value: 359 },
  { name: "Ukraine", value: 380 },
  { name: "Serbia", value: 381 },
  { name: "Croatia", value: 385 },
  { name: "Czech Republic", value: 420, aliases: ["Czechia"] },
  { name: "Bangladesh", value: 880 },
  { name: "Saudi Arabia", value: 966 },
  { name: "United Arab Emirates", value: 971, aliases: ["UAE"] },
  { name: "Israel", value: 972 },
  { name: "Qatar", value: 974 },
  { name: "Nepal", value: 977 },
];

/** Fixed-date days, by their day of a non-leap year: 1 January is 1, 31 December 365. */
const DAYS_OF_THE_YEAR: readonly TonUpAnswer[] = [
  { name: "New Year's Day", value: 1 },
  { name: "Epiphany", value: 6 },
  { name: "Burns Night", value: 25 },
  { name: "Australia Day", value: 26 },
  { name: "Holocaust Remembrance Day", value: 27 },
  { name: "Groundhog Day", value: 33 },
  { name: "Valentine's Day", value: 45, aliases: ["Valentines Day"] },
  { name: "St David's Day", value: 60, aliases: ["Saint David's Day"] },
  { name: "International Women's Day", value: 67, aliases: ["Women's Day"] },
  { name: "Pi Day", value: 73 },
  { name: "St Patrick's Day", value: 76, aliases: ["Saint Patrick's Day"] },
  { name: "World Water Day", value: 81 },
  { name: "April Fools' Day", value: 91, aliases: ["April Fools Day"] },
  { name: "World Health Day", value: 97 },
  { name: "Earth Day", value: 112 },
  { name: "St George's Day", value: 113, aliases: ["Saint George's Day"] },
  { name: "May Day", value: 121, aliases: ["International Workers' Day", "Labour Day"] },
  { name: "Cinco de Mayo", value: 125 },
  { name: "World Environment Day", value: 156 },
  { name: "Juneteenth", value: 170 },
  { name: "Canada Day", value: 182 },
  { name: "Independence Day (US)", value: 185, aliases: ["Fourth of July", "July 4th"] },
  { name: "Bastille Day", value: 195 },
  { name: "Halloween", value: 304 },
  { name: "Guy Fawkes Night", value: 309, aliases: ["Bonfire Night"] },
  { name: "Veterans Day", value: 315, aliases: ["Armistice Day", "Remembrance Day"] },
  { name: "Christmas Eve", value: 358 },
  { name: "Christmas Day", value: 359, aliases: ["Christmas"] },
  { name: "Boxing Day", value: 360 },
  { name: "New Year's Eve", value: 365, aliases: ["Hogmanay"] },
];

function numbered(
  names: readonly string[],
  aliases: Record<string, readonly string[]> = {},
): TonUpAnswer[] {
  return names.map((name, index) => ({ name, value: index + 1, aliases: aliases[name] }));
}

/** Every category, in the order the days walk them. */
export const TON_UP_CATEGORIES: readonly TonUpCategory[] = [
  {
    title: "Chemical elements",
    unit: "atomic number",
    source: "The periodic table: hydrogen is 1, oganesson 118.",
    answers: numbered(ELEMENTS, ELEMENT_ALIASES),
  },
  {
    title: "US presidents",
    unit: "president number",
    source: "Washington is 1; Cleveland and Trump count once per term.",
    answers: numbered(PRESIDENTS, PRESIDENT_ALIASES),
  },
  {
    title: "US states",
    unit: "order of statehood",
    source: "Delaware joined first (1), Hawaii last (50).",
    answers: numbered(STATES),
  },
  {
    title: "Country calling codes",
    unit: "dialling code",
    source: "The international code you dial before the number: +1, +44, +355…",
    answers: CALLING_CODES,
  },
  {
    title: "Days of the year",
    unit: "day of the year",
    source: "Fixed-date days by their day of a non-leap year: 1 January is 1.",
    answers: DAYS_OF_THE_YEAR,
  },
];
