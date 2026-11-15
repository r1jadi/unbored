/**
 * Only Once's facts: the things a question can ask for, and what is true of each.
 *
 * Three kinds of thing — countries, US states and chemical elements — each a list
 * whose order is its ids (never reorder or remove one: add at the end, under a new
 * rules version). The questions in `only-once-bank.ts` are sets over these lists,
 * worked out from the facts here, never typed by hand.
 *
 * Countries are the 193 United Nations members and Vatican City. A country that
 * spans two continents counts for both (Russia, Turkey, Egypt…), so neither answer
 * is turned down.
 */

export type Entity = {
  readonly name: string;
  readonly aliases?: readonly string[];
};

// ── Countries ──────────────────────────────────────────────────────────────────

const AFRICA = [
  "Algeria", "Angola", "Benin", "Botswana", "Burkina Faso", "Burundi", "Cameroon", "Cape Verde",
  "Central African Republic", "Chad", "Comoros", "Democratic Republic of the Congo",
  "Republic of the Congo", "Djibouti", "Egypt", "Equatorial Guinea", "Eritrea", "Eswatini",
  "Ethiopia", "Gabon", "Gambia", "Ghana", "Guinea", "Guinea-Bissau", "Ivory Coast", "Kenya",
  "Lesotho", "Liberia", "Libya", "Madagascar", "Malawi", "Mali", "Mauritania", "Mauritius",
  "Morocco", "Mozambique", "Namibia", "Niger", "Nigeria", "Rwanda", "São Tomé and Príncipe",
  "Senegal", "Seychelles", "Sierra Leone", "Somalia", "South Africa", "South Sudan", "Sudan",
  "Tanzania", "Togo", "Tunisia", "Uganda", "Zambia", "Zimbabwe",
]; // prettier-ignore

const EUROPE = [
  "Albania", "Andorra", "Austria", "Belarus", "Belgium", "Bosnia and Herzegovina", "Bulgaria",
  "Croatia", "Czech Republic", "Denmark", "Estonia", "Finland", "France", "Germany", "Greece",
  "Hungary", "Iceland", "Ireland", "Italy", "Latvia", "Liechtenstein", "Lithuania",
  "Luxembourg", "Malta", "Moldova", "Monaco", "Montenegro", "Netherlands", "North Macedonia",
  "Norway", "Poland", "Portugal", "Romania", "San Marino", "Serbia", "Slovakia", "Slovenia",
  "Spain", "Sweden", "Switzerland", "Ukraine", "United Kingdom", "Vatican City",
]; // prettier-ignore

/** In Europe and in Asia. */
const EURASIA = ["Russia", "Turkey", "Georgia", "Armenia", "Azerbaijan", "Kazakhstan", "Cyprus"];

const ASIA = [
  "Afghanistan", "Bahrain", "Bangladesh", "Bhutan", "Brunei", "Cambodia", "China", "India",
  "Indonesia", "Iran", "Iraq", "Israel", "Japan", "Jordan", "Kuwait", "Kyrgyzstan", "Laos",
  "Lebanon", "Malaysia", "Maldives", "Mongolia", "Myanmar", "Nepal", "North Korea", "Oman",
  "Pakistan", "Philippines", "Qatar", "Saudi Arabia", "Singapore", "South Korea", "Sri Lanka",
  "Syria", "Tajikistan", "Thailand", "East Timor", "Turkmenistan", "United Arab Emirates",
  "Uzbekistan", "Vietnam", "Yemen",
]; // prettier-ignore

const NORTH_AMERICA = [
  "Antigua and Barbuda", "Bahamas", "Barbados", "Belize", "Canada", "Costa Rica", "Cuba",
  "Dominica", "Dominican Republic", "El Salvador", "Grenada", "Guatemala", "Haiti", "Honduras",
  "Jamaica", "Mexico", "Nicaragua", "Panama", "Saint Kitts and Nevis", "Saint Lucia",
  "Saint Vincent and the Grenadines", "Trinidad and Tobago", "United States",
]; // prettier-ignore

const SOUTH_AMERICA = [
  "Argentina", "Bolivia", "Brazil", "Chile", "Colombia", "Ecuador", "Guyana", "Paraguay", "Peru",
  "Suriname", "Uruguay", "Venezuela",
]; // prettier-ignore

const OCEANIA = [
  "Australia", "Fiji", "Kiribati", "Marshall Islands", "Micronesia", "Nauru", "New Zealand",
  "Palau", "Papua New Guinea", "Samoa", "Solomon Islands", "Tonga", "Tuvalu", "Vanuatu",
]; // prettier-ignore

const COUNTRY_ALIASES: Record<string, readonly string[]> = {
  "United States": ["USA", "US", "United States of America", "America"],
  "United Kingdom": ["UK", "Britain", "Great Britain"],
  "Czech Republic": ["Czechia"],
  "Ivory Coast": ["Côte d'Ivoire", "Cote d'Ivoire"],
  "Democratic Republic of the Congo": ["DR Congo", "DRC", "Congo-Kinshasa"],
  "Republic of the Congo": ["Congo", "Congo-Brazzaville"],
  "East Timor": ["Timor-Leste"],
  "Eswatini": ["Swaziland"],
  "Myanmar": ["Burma"],
  "Cape Verde": ["Cabo Verde"],
  "North Macedonia": ["Macedonia"],
  "Netherlands": ["Holland", "The Netherlands"],
  "Vatican City": ["Vatican", "Holy See"],
  "United Arab Emirates": ["UAE"],
  "South Korea": ["Korea"],
  "Turkey": ["Türkiye", "Turkiye"],
  "Gambia": ["The Gambia"],
  "Bahamas": ["The Bahamas"],
  "Micronesia": ["Federated States of Micronesia"],
  "São Tomé and Príncipe": ["Sao Tome and Principe", "Sao Tome"],
  "Bosnia and Herzegovina": ["Bosnia"],
}; // prettier-ignore

export const COUNTRIES: readonly Entity[] = [
  ...AFRICA,
  ...EUROPE,
  ...EURASIA,
  ...ASIA,
  ...NORTH_AMERICA,
  ...SOUTH_AMERICA,
  ...OCEANIA,
].map((name) => ({ name, aliases: COUNTRY_ALIASES[name] }));

export const CONTINENTS: Record<string, readonly string[]> = {
  Africa: [...AFRICA],
  Europe: [...EUROPE, ...EURASIA],
  Asia: [...ASIA, ...EURASIA, "Egypt"],
  "North America": NORTH_AMERICA,
  "South America": SOUTH_AMERICA,
  Oceania: OCEANIA,
};

export const LANDLOCKED = [
  // Africa
  "Botswana", "Burkina Faso", "Burundi", "Central African Republic", "Chad", "Eswatini",
  "Ethiopia", "Lesotho", "Malawi", "Mali", "Niger", "Rwanda", "South Sudan", "Uganda", "Zambia",
  "Zimbabwe",
  // Europe
  "Andorra", "Austria", "Belarus", "Czech Republic", "Hungary", "Liechtenstein", "Luxembourg",
  "Moldova", "North Macedonia", "San Marino", "Serbia", "Slovakia", "Switzerland", "Vatican City",
  // Asia
  "Afghanistan", "Armenia", "Azerbaijan", "Bhutan", "Kazakhstan", "Kyrgyzstan", "Laos",
  "Mongolia", "Nepal", "Tajikistan", "Turkmenistan", "Uzbekistan",
  // South America
  "Bolivia", "Paraguay",
]; // prettier-ignore

/** Countries made up only of islands, or of parts of them. */
export const ISLAND_NATIONS = [
  "Antigua and Barbuda", "Bahamas", "Bahrain", "Barbados", "Brunei", "Cape Verde", "Comoros",
  "Cuba", "Cyprus", "Dominica", "Dominican Republic", "East Timor", "Fiji", "Grenada", "Haiti",
  "Iceland", "Indonesia", "Ireland", "Jamaica", "Japan", "Kiribati", "Madagascar", "Maldives",
  "Malta", "Marshall Islands", "Mauritius", "Micronesia", "Nauru", "New Zealand", "Palau",
  "Papua New Guinea", "Philippines", "Saint Kitts and Nevis", "Saint Lucia",
  "Saint Vincent and the Grenadines", "Samoa", "São Tomé and Príncipe", "Seychelles", "Singapore",
  "Solomon Islands", "Sri Lanka", "Tonga", "Trinidad and Tobago", "Tuvalu", "United Kingdom",
  "Vanuatu",
]; // prettier-ignore

export const MEDITERRANEAN = [
  "Spain", "France", "Monaco", "Italy", "Malta", "Slovenia", "Croatia", "Bosnia and Herzegovina",
  "Montenegro", "Albania", "Greece", "Turkey", "Cyprus", "Syria", "Lebanon", "Israel", "Egypt",
  "Libya", "Tunisia", "Algeria", "Morocco",
]; // prettier-ignore

export const SPANISH_SPEAKING = [
  "Spain", "Mexico", "Guatemala", "Honduras", "El Salvador", "Nicaragua", "Costa Rica", "Panama",
  "Cuba", "Dominican Republic", "Colombia", "Venezuela", "Ecuador", "Peru", "Bolivia", "Chile",
  "Argentina", "Paraguay", "Uruguay", "Equatorial Guinea",
]; // prettier-ignore

export const PORTUGUESE_SPEAKING = [
  "Portugal", "Brazil", "Angola", "Mozambique", "Cape Verde", "Guinea-Bissau",
  "São Tomé and Príncipe", "East Timor", "Equatorial Guinea",
]; // prettier-ignore

export const EUROPEAN_UNION = [
  "Austria", "Belgium", "Bulgaria", "Croatia", "Cyprus", "Czech Republic", "Denmark", "Estonia",
  "Finland", "France", "Germany", "Greece", "Hungary", "Ireland", "Italy", "Latvia", "Lithuania",
  "Luxembourg", "Malta", "Netherlands", "Poland", "Portugal", "Romania", "Slovakia", "Slovenia",
  "Spain", "Sweden",
]; // prettier-ignore

/** Land borders, for "Name a country that borders …". */
export const COUNTRY_BORDERS: Record<string, readonly string[]> = {
  China: [
    "Afghanistan", "Bhutan", "India", "Kazakhstan", "North Korea", "Kyrgyzstan", "Laos",
    "Mongolia", "Myanmar", "Nepal", "Pakistan", "Russia", "Tajikistan", "Vietnam",
  ],
  Russia: [
    "Norway", "Finland", "Estonia", "Latvia", "Lithuania", "Poland", "Belarus", "Ukraine",
    "Georgia", "Azerbaijan", "Kazakhstan", "China", "Mongolia", "North Korea",
  ],
  Germany: [
    "Denmark", "Poland", "Czech Republic", "Austria", "Switzerland", "France", "Luxembourg",
    "Belgium", "Netherlands",
  ],
  Brazil: [
    "Argentina", "Bolivia", "Colombia", "Guyana", "Paraguay", "Peru", "Suriname", "Uruguay",
    "Venezuela", "France",
  ],
  Austria: [
    "Germany", "Czech Republic", "Slovakia", "Hungary", "Slovenia", "Italy", "Switzerland",
    "Liechtenstein",
  ],
  Turkey: ["Greece", "Bulgaria", "Georgia", "Armenia", "Azerbaijan", "Iran", "Iraq", "Syria"],
  "Saudi Arabia": ["Jordan", "Iraq", "Kuwait", "Qatar", "United Arab Emirates", "Oman", "Yemen"],
  "South Africa": ["Namibia", "Botswana", "Zimbabwe", "Mozambique", "Eswatini", "Lesotho"],
  Tanzania: [
    "Kenya", "Uganda", "Rwanda", "Burundi", "Democratic Republic of the Congo", "Zambia",
    "Malawi", "Mozambique",
  ],
  "Democratic Republic of the Congo": [
    "Republic of the Congo", "Central African Republic", "South Sudan", "Uganda", "Rwanda",
    "Burundi", "Tanzania", "Zambia", "Angola",
  ],
  Argentina: ["Chile", "Bolivia", "Paraguay", "Brazil", "Uruguay"],
}; // prettier-ignore

// ── US states ──────────────────────────────────────────────────────────────────

const NORTHEAST = [
  "Connecticut", "Maine", "Massachusetts", "New Hampshire", "Rhode Island", "Vermont",
  "New Jersey", "New York", "Pennsylvania",
]; // prettier-ignore
const MIDWEST = [
  "Illinois", "Indiana", "Michigan", "Ohio", "Wisconsin", "Iowa", "Kansas", "Minnesota",
  "Missouri", "Nebraska", "North Dakota", "South Dakota",
]; // prettier-ignore
const SOUTH = [
  "Delaware", "Florida", "Georgia", "Maryland", "North Carolina", "South Carolina", "Virginia",
  "West Virginia", "Alabama", "Kentucky", "Mississippi", "Tennessee", "Arkansas", "Louisiana",
  "Oklahoma", "Texas",
]; // prettier-ignore
const WEST = [
  "Arizona", "Colorado", "Idaho", "Montana", "Nevada", "New Mexico", "Utah", "Wyoming", "Alaska",
  "California", "Hawaii", "Oregon", "Washington",
]; // prettier-ignore

export const US_STATES: readonly Entity[] = [...NORTHEAST, ...MIDWEST, ...SOUTH, ...WEST].map(
  (name) => ({ name }),
);

export const STATE_REGIONS: Record<string, readonly string[]> = {
  "the Northeast": NORTHEAST,
  "the Midwest": MIDWEST,
  "the South": SOUTH,
  "the West": WEST,
};

export const STATE_SETS: Record<string, readonly string[]> = {
  "Name a US state that borders Canada": [
    "Alaska", "Washington", "Idaho", "Montana", "North Dakota", "Minnesota", "Michigan", "Ohio",
    "Pennsylvania", "New York", "Vermont", "New Hampshire", "Maine",
  ],
  "Name a US state that borders Mexico": ["California", "Arizona", "New Mexico", "Texas"],
  "Name a US state on the Pacific coast": ["California", "Oregon", "Washington", "Alaska", "Hawaii"],
  "Name a US state on the Gulf of Mexico": [
    "Texas", "Louisiana", "Mississippi", "Alabama", "Florida",
  ],
  "Name a US state on the Atlantic coast": [
    "Maine", "New Hampshire", "Massachusetts", "Rhode Island", "Connecticut", "New York",
    "New Jersey", "Delaware", "Maryland", "Virginia", "North Carolina", "South Carolina",
    "Georgia", "Florida",
  ],
  "Name a US state on one of the Great Lakes": [
    "Minnesota", "Wisconsin", "Illinois", "Indiana", "Michigan", "Ohio", "Pennsylvania",
    "New York",
  ],
  "Name one of the original thirteen colonies": [
    "Delaware", "Pennsylvania", "New Jersey", "Georgia", "Connecticut", "Massachusetts",
    "Maryland", "South Carolina", "New Hampshire", "Virginia", "New York", "North Carolina",
    "Rhode Island",
  ],
  "Name a US state that borders Tennessee": [
    "Kentucky", "Virginia", "North Carolina", "Georgia", "Alabama", "Mississippi", "Arkansas",
    "Missouri",
  ],
  "Name a US state that borders Missouri": [
    "Iowa", "Illinois", "Kentucky", "Tennessee", "Arkansas", "Oklahoma", "Kansas", "Nebraska",
  ],
  "Name a US state that borders Colorado": [
    "Wyoming", "Nebraska", "Kansas", "Oklahoma", "New Mexico", "Arizona", "Utah",
  ],
  "Name a US state that borders Kentucky": [
    "Illinois", "Indiana", "Ohio", "West Virginia", "Virginia", "Tennessee", "Missouri",
  ],
  "Name a US state that borders Pennsylvania": [
    "New York", "New Jersey", "Delaware", "Maryland", "West Virginia", "Ohio",
  ],
  "Name a US state on the Mississippi River": [
    "Minnesota", "Wisconsin", "Iowa", "Illinois", "Missouri", "Kentucky", "Tennessee",
    "Arkansas", "Mississippi", "Louisiana",
  ],
  "Name a Four Corners state": ["Arizona", "Colorado", "New Mexico", "Utah"],
  "Name a US state that borders Texas": ["New Mexico", "Oklahoma", "Arkansas", "Louisiana"],
}; // prettier-ignore

// ── Chemical elements ──────────────────────────────────────────────────────────

export const ELEMENT_NAMES = [
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

export const ELEMENT_SYMBOLS = [
  "H", "He", "Li", "Be", "B", "C", "N", "O", "F", "Ne", "Na", "Mg", "Al", "Si", "P", "S", "Cl",
  "Ar", "K", "Ca", "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn", "Ga", "Ge", "As",
  "Se", "Br", "Kr", "Rb", "Sr", "Y", "Zr", "Nb", "Mo", "Tc", "Ru", "Rh", "Pd", "Ag", "Cd", "In",
  "Sn", "Sb", "Te", "I", "Xe", "Cs", "Ba", "La", "Ce", "Pr", "Nd", "Pm", "Sm", "Eu", "Gd", "Tb",
  "Dy", "Ho", "Er", "Tm", "Yb", "Lu", "Hf", "Ta", "W", "Re", "Os", "Ir", "Pt", "Au", "Hg", "Tl",
  "Pb", "Bi", "Po", "At", "Rn", "Fr", "Ra", "Ac", "Th", "Pa", "U", "Np", "Pu", "Am", "Cm", "Bk",
  "Cf", "Es", "Fm", "Md", "No", "Lr", "Rf", "Db", "Sg", "Bh", "Hs", "Mt", "Ds", "Rg", "Cn", "Nh",
  "Fl", "Mc", "Lv", "Ts", "Og",
]; // prettier-ignore

const ELEMENT_ALIASES: Record<string, readonly string[]> = {
  Aluminium: ["Aluminum"],
  Sulfur: ["Sulphur"],
  Caesium: ["Cesium"],
};

export const ELEMENTS: readonly Entity[] = ELEMENT_NAMES.map((name, index) => ({
  name,
  aliases: [...(ELEMENT_ALIASES[name] ?? []), ELEMENT_SYMBOLS[index]!],
}));

/** Symbols by group, for the group questions. */
export const ELEMENT_SETS: Record<string, readonly string[]> = {
  "Name a noble gas": ["He", "Ne", "Ar", "Kr", "Xe", "Rn", "Og"],
  "Name an alkali metal": ["Li", "Na", "K", "Rb", "Cs", "Fr"],
  "Name an alkaline earth metal": ["Be", "Mg", "Ca", "Sr", "Ba", "Ra"],
  "Name a halogen": ["F", "Cl", "Br", "I", "At", "Ts"],
  "Name an element that is a gas at room temperature": [
    "H", "He", "N", "O", "F", "Ne", "Cl", "Ar", "Kr", "Xe", "Rn",
  ],
}; // prettier-ignore

/** The period (row) of the element with this atomic number. */
export function periodOf(atomicNumber: number): number {
  const ends = [2, 10, 18, 36, 54, 86, 118];
  return ends.findIndex((end) => atomicNumber <= end) + 1;
}
