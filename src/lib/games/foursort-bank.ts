/**
 * Foursort's puzzles: sixteen words a day, four hidden groups of four.
 *
 * Day `d` plays puzzle `d mod n`. A word's id is its place in the puzzle: group
 * `g` (0 – 3, easiest first) word `w` (0 – 3) is id `4g + w`. The database never
 * needs the words — every puzzle has the same shape, so a group is always the
 * same four ids — which is why this bank has no copy in a migration.
 *
 * A puzzle's place in the list is its day: only add at the end. Words may
 * tempt toward another group (that is the game) but each must belong to exactly
 * one; `foursort.test.ts` checks every puzzle has sixteen different words.
 */

export type FoursortGroup = {
  /** What the four have in common, shown once the group is found. */
  readonly title: string;
  readonly words: readonly [string, string, string, string];
};

export type FoursortPuzzle = {
  /** Easiest first: the groups' order is their colour, yellow to purple. */
  readonly groups: readonly [FoursortGroup, FoursortGroup, FoursortGroup, FoursortGroup];
};

function p(
  ...groups: [
    [string, string, string, string, string],
    ...[string, string, string, string, string][],
  ]
): FoursortPuzzle {
  if (groups.length !== 4) throw new Error("a Foursort puzzle has four groups");
  return {
    groups: groups.map(([title, ...words]) => ({
      title,
      words: words as [string, string, string, string],
    })) as unknown as FoursortPuzzle["groups"],
  };
}

export const FOURSORT_PUZZLES: readonly FoursortPuzzle[] = [
  p(
    ["Fruits", "Apple", "Banana", "Cherry", "Grape"],
    ["Planets", "Mars", "Venus", "Saturn", "Jupiter"],
    ["Chocolate bars", "Twix", "Bounty", "Snickers", "Galaxy"],
    ["Tech companies", "Amazon", "Oracle", "Meta", "Intel"],
  ),
  p(
    ["Pets", "Hamster", "Parrot", "Goldfish", "Rabbit"],
    ["Chess pieces", "King", "Bishop", "Knight", "Rook"],
    ["Card games", "Poker", "Bridge", "Snap", "Rummy"],
    ["___ ball", "Foot", "Basket", "Snow", "Meat"],
  ),
  p(
    ["Colours", "Red", "Blue", "Green", "Yellow"],
    ["Weather", "Rain", "Snow", "Hail", "Fog"],
    ["Coffee drinks", "Latte", "Mocha", "Espresso", "Cappuccino"],
    ["Body parts", "Shin", "Chin", "Lip", "Ear"],
  ),
  p(
    ["Kitchen tools", "Whisk", "Ladle", "Spatula", "Grater"],
    ["Dances", "Tango", "Salsa", "Waltz", "Samba"],
    ["Greek letters", "Alpha", "Delta", "Sigma", "Omega"],
    ["NATO alphabet", "Kilo", "Hotel", "Juliett", "Victor"],
  ),
  p(
    ["Trees", "Oak", "Pine", "Birch", "Maple"],
    ["Rivers", "Nile", "Amazon", "Danube", "Thames"],
    ["Keyboard keys", "Shift", "Enter", "Escape", "Tab"],
    ["Things that bark", "Dog", "Seal", "Fox", "Coyote"],
  ),
  p(
    ["Breakfast foods", "Toast", "Cereal", "Pancake", "Omelette"],
    ["Musical instruments", "Violin", "Trumpet", "Flute", "Cello"],
    ["Clouds", "Cirrus", "Cumulus", "Stratus", "Nimbus"],
    ["Mythical creatures", "Dragon", "Unicorn", "Phoenix", "Griffin"],
  ),
  p(
    ["Shapes", "Circle", "Square", "Triangle", "Hexagon"],
    ["Footwear", "Boot", "Sandal", "Slipper", "Sneaker"],
    ["Bones", "Femur", "Tibia", "Skull", "Rib"],
    ["Words before 'light'", "Moon", "Flash", "Spot", "Head"],
  ),
  p(
    ["Vegetables", "Carrot", "Onion", "Potato", "Leek"],
    ["Sea creatures", "Octopus", "Dolphin", "Squid", "Shark"],
    ["Italian dishes", "Lasagne", "Risotto", "Pizza", "Gnocchi"],
    ["Starts with a metal", "Tinsel", "Golden", "Ironic", "Leaden"],
  ),
  p(
    ["Sports", "Tennis", "Rugby", "Hockey", "Golf"],
    ["Herbs", "Basil", "Mint", "Thyme", "Parsley"],
    ["Famous detectives", "Poirot", "Marple", "Holmes", "Columbo"],
    ["Rhymes with 'time'", "Lime", "Crime", "Chime", "Climb"],
  ),
  p(
    ["Birds", "Robin", "Eagle", "Sparrow", "Owl"],
    ["Currencies", "Euro", "Dollar", "Yen", "Rupee"],
    ["Superheroes", "Batman", "Superman", "Thor", "Hulk"],
    ["Batman's sidekicks", "Nightwing", "Batgirl", "Alfred", "Oracle"],
  ),
  p(
    ["Furniture", "Sofa", "Table", "Wardrobe", "Stool"],
    ["Gemstones", "Ruby", "Emerald", "Sapphire", "Diamond"],
    ["Programming languages", "Python", "Java", "Rust", "Swift"],
    ["Snakes", "Cobra", "Viper", "Mamba", "Adder"],
  ),
  p(
    ["Seasons", "Spring", "Summer", "Autumn", "Winter"],
    ["Money slang", "Quid", "Buck", "Grand", "Dime"],
    ["Months that are also words", "March", "May", "August", "June"],
    ["Bed parts", "Mattress", "Pillow", "Duvet", "Sheet"],
  ),
  p(
    ["Cheeses", "Cheddar", "Brie", "Feta", "Gouda"],
    ["Capital cities", "Paris", "Tirana", "Rome", "Oslo"],
    ["Board games", "Monopoly", "Scrabble", "Cluedo", "Risk"],
    ["Words with 'cat' inside", "Location", "Scatter", "Vacation", "Educate"],
  ),
  p(
    ["Body of water", "Lake", "Pond", "Ocean", "Lagoon"],
    ["Tools", "Hammer", "Wrench", "Saw", "Drill"],
    ["Sharks", "Hammerhead", "Tiger", "Mako", "Great White"],
    ["Bowling terms", "Strike", "Spare", "Gutter", "Lane"],
  ),
  p(
    ["Insects", "Beetle", "Ant", "Wasp", "Moth"],
    ["The Beatles", "John", "Paul", "George", "Ringo"],
    ["Cars", "Mustang", "Corolla", "Civic", "Golf"],
    ["Popes", "Francis", "Benedict", "Leo", "Pius"],
  ),
  p(
    ["Pasta", "Penne", "Fusilli", "Spaghetti", "Ravioli"],
    ["Yoga poses", "Tree", "Warrior", "Plank", "Lotus"],
    ["Flowers", "Rose", "Tulip", "Daisy", "Lily"],
    ["Famous Toms", "Hanks", "Cruise", "Hardy", "Holland"],
  ),
  p(
    ["Office supplies", "Stapler", "Pen", "Paperclip", "Folder"],
    ["Horse colours", "Bay", "Chestnut", "Grey", "Palomino"],
    ["Baked goods", "Muffin", "Croissant", "Bagel", "Scone"],
    ["Computer parts", "Mouse", "Monitor", "Keyboard", "Speaker"],
  ),
  p(
    ["Weather words", "Breeze", "Gale", "Drizzle", "Frost"],
    ["Fish", "Salmon", "Trout", "Cod", "Tuna"],
    ["Shades of pink", "Coral", "Fuchsia", "Blush", "Flamingo"],
    ["Words before 'fly'", "Butter", "Dragon", "Fire", "House"],
  ),
  p(
    ["Dog breeds", "Poodle", "Beagle", "Boxer", "Collie"],
    ["Martial arts", "Karate", "Judo", "Kung Fu", "Taekwondo"],
    ["Fighters", "Ali", "Tyson", "Lee", "Rocky"],
    ["Pokémon", "Pikachu", "Eevee", "Snorlax", "Charmander"],
  ),
  p(
    ["Drinks", "Juice", "Tea", "Lemonade", "Milk"],
    ["Clothing", "Shirt", "Jacket", "Scarf", "Jeans"],
    ["Poker hands", "Flush", "Straight", "Pair", "Full House"],
    ["Toilet words", "Loo", "Lavatory", "Restroom", "Bathroom"],
  ),
  p(
    ["Zoo animals", "Lion", "Zebra", "Giraffe", "Elephant"],
    ["Mountains", "Everest", "Kilimanjaro", "Olympus", "Fuji"],
    ["Greek gods", "Zeus", "Apollo", "Athena", "Hermes"],
    ["Car brands named after people", "Ferrari", "Porsche", "Ford", "Honda"],
  ),
  p(
    ["Breads", "Baguette", "Pitta", "Naan", "Brioche"],
    ["Ocean animals", "Whale", "Seahorse", "Starfish", "Jellyfish"],
    ["Constellations", "Orion", "Pegasus", "Draco", "Cassiopeia"],
    ["Things that are pressed", "Button", "Charges", "Flowers", "Shirts"],
  ),
  p(
    ["Desserts", "Brownie", "Tiramisu", "Cheesecake", "Pudding"],
    ["Elements", "Carbon", "Oxygen", "Neon", "Helium"],
    ["Words after 'sun'", "Flower", "Shine", "Burn", "Glasses"],
    ["Fizzy drinks", "Cola", "Tonic", "Soda", "Ginger Ale"],
  ),
  p(
    ["Transport", "Bus", "Train", "Tram", "Ferry"],
    ["Hairstyles", "Bob", "Mohawk", "Ponytail", "Braid"],
    ["Palindromes", "Kayak", "Radar", "Level", "Rotor"],
    ["Famous Bobs", "Marley", "Dylan", "Ross", "Hope"],
  ),
  p(
    ["Rooms", "Kitchen", "Bedroom", "Attic", "Cellar"],
    ["Nuts", "Almond", "Cashew", "Walnut", "Pecan"],
    ["Shakespeare plays", "Hamlet", "Macbeth", "Othello", "Tempest"],
    ["Small places to live", "Hut", "Cabin", "Shack", "Hovel"],
  ),
  p(
    ["Jewellery", "Ring", "Necklace", "Bracelet", "Earring"],
    ["Boxing terms", "Jab", "Hook", "Uppercut", "Knockout"],
    ["Fishing gear", "Rod", "Reel", "Bait", "Net"],
    ["Phone actions", "Swipe", "Scroll", "Tap", "Pinch"],
  ),
  p(
    ["Farm animals", "Cow", "Pig", "Sheep", "Goat"],
    ["Planets' moons", "Titan", "Europa", "Io", "Phobos"],
    ["Wizards", "Merlin", "Gandalf", "Dumbledore", "Oz"],
    ["Spices", "Cumin", "Paprika", "Turmeric", "Saffron"],
  ),
  p(
    ["Instruments with strings", "Guitar", "Harp", "Banjo", "Ukulele"],
    ["Breakfast cereals", "Muesli", "Granola", "Porridge", "Cornflakes"],
    ["Crossword clue words", "Across", "Down", "Grid", "Clue"],
    ["Words before 'board'", "Card", "Key", "Skate", "Surf"],
  ),
  p(
    ["Sandwich fillings", "Ham", "Tuna Mayo", "Egg", "Cheese"],
    ["Big cats", "Leopard", "Jaguar", "Cheetah", "Puma"],
    ["Sports brands", "Nike", "Adidas", "Reebok", "Umbro"],
    ["Greek letters spelled out", "Beta", "Gamma", "Theta", "Kappa"],
  ),
  p(
    ["Garden things", "Shed", "Hose", "Lawn", "Fence"],
    ["Ballet terms", "Plié", "Pirouette", "Arabesque", "Jeté"],
    ["Eyes", "Iris", "Pupil", "Retina", "Cornea"],
    ["School things", "Locker", "Satchel", "Homework", "Timetable"],
  ),
];
