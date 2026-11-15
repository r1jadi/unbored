/**
 * Ballpark's shelf: one product a day, with a typical US shelf price.
 *
 * The prices are typical, not any one shop's: a fair guess for the item as
 * described, in US dollars, in 2026. Day `d` is product `d mod n`; the list is in
 * the order the days walk it, so neighbours differ on purpose.
 *
 * Only the prices reach the database — `public.ballpark_prices` in
 * `supabase/migrations/20270104120100_ballpark_sessions.sql`, in cents, in this
 * order — and `ballpark.test.ts` asserts that the two copies match. Rewrite the
 * migration's list with `bun scripts/generate-daily-banks.ts --write` after
 * changing anything here. Never reorder or remove a product, only add at the end.
 */

export type BallparkProduct = {
  readonly name: string;
  /** Size, pack or model: what exactly is on the shelf. */
  readonly detail: string;
  readonly emoji: string;
  /** The price, in cents. */
  readonly cents: number;
};

export const BALLPARK_PRODUCTS: readonly BallparkProduct[] = [
  { name: "Bananas", detail: "1 lb, about three", emoji: "🍌", cents: 65 },
  { name: "Robot vacuum", detail: "Mid-range, app-controlled", emoji: "🤖", cents: 29999 },
  { name: "Large eggs", detail: "Carton of 12", emoji: "🥚", cents: 349 },
  { name: "Garden hose", detail: "50 ft, kink-resistant", emoji: "🪴", cents: 3499 },
  { name: "Whole milk", detail: "1 gallon", emoji: "🥛", cents: 399 },
  { name: "Air fryer", detail: "6-quart basket", emoji: "🍟", cents: 8999 },
  { name: "Avocado", detail: "One large Hass", emoji: "🥑", cents: 150 },
  { name: "Cordless drill", detail: "20 V, with battery and charger", emoji: "🔩", cents: 9900 },
  { name: "Sliced white bread", detail: "20 oz loaf", emoji: "🍞", cents: 299 },
  { name: "Wireless earbuds", detail: "Noise-cancelling, name brand", emoji: "🎧", cents: 24900 },
  { name: "Ground coffee", detail: "12 oz bag, medium roast", emoji: "☕", cents: 899 },
  {
    name: "Queen mattress",
    detail: "Medium-firm memory foam, in a box",
    emoji: "🛏️",
    cents: 54900,
  },
  { name: "Peanut butter", detail: "16 oz jar, creamy", emoji: "🥜", cents: 329 },
  { name: "Bicycle helmet", detail: "Adult, basic", emoji: "🚲", cents: 3999 },
  { name: "Orange juice", detail: "52 oz, not from concentrate", emoji: "🍊", cents: 499 },
  { name: "65-inch 4K TV", detail: "LED, mid-range brand", emoji: "📺", cents: 49999 },
  { name: "Unsalted butter", detail: "1 lb, four sticks", emoji: "🧈", cents: 549 },
  { name: "Yoga mat", detail: "6 mm, non-slip", emoji: "🧘", cents: 2499 },
  { name: "Cheddar cheese", detail: "8 oz block, sharp", emoji: "🧀", cents: 349 },
  {
    name: "Electric toothbrush",
    detail: "Rechargeable, two-minute timer",
    emoji: "🪥",
    cents: 4999,
  },
  { name: "Spaghetti", detail: "1 lb box", emoji: "🍝", cents: 179 },
  { name: "Microwave", detail: "1.1 cu ft countertop", emoji: "📡", cents: 12999 },
  { name: "Rotisserie chicken", detail: "Whole, hot from the deli", emoji: "🍗", cents: 799 },
  { name: "Charcoal grill", detail: "22-inch kettle", emoji: "🔥", cents: 18900 },
  { name: "Strawberries", detail: "1 lb clamshell", emoji: "🍓", cents: 399 },
  { name: "Laptop backpack", detail: "Fits a 15-inch laptop", emoji: "🎒", cents: 4499 },
  { name: "Paper towels", detail: "6 double rolls", emoji: "🧻", cents: 1299 },
  { name: "Stand mixer", detail: "5-quart tilt-head", emoji: "🍰", cents: 37999 },
  { name: "Canned tuna", detail: "5 oz can, chunk light", emoji: "🐟", cents: 139 },
  { name: "Running shoes", detail: "Name-brand everyday trainer", emoji: "👟", cents: 13000 },
  { name: "Frozen pizza", detail: "12-inch pepperoni", emoji: "🍕", cents: 699 },
  { name: "Smartwatch", detail: "Entry model, GPS", emoji: "⌚", cents: 24900 },
  { name: "Honey", detail: "12 oz squeeze bottle", emoji: "🍯", cents: 549 },
  { name: "Space heater", detail: "1500 W ceramic", emoji: "♨️", cents: 4499 },
  { name: "Greek yogurt", detail: "32 oz tub, plain", emoji: "🥣", cents: 599 },
  { name: "Electric scooter", detail: "Adult commuter, 15 mph", emoji: "🛴", cents: 44999 },
  { name: "Apples", detail: "3 lb bag, Gala", emoji: "🍎", cents: 499 },
  { name: "Dish soap", detail: "28 oz bottle", emoji: "🧼", cents: 399 },
  { name: "Game console", detail: "Current-generation, disc edition", emoji: "🎮", cents: 49999 },
  { name: "Olive oil", detail: "500 ml, extra virgin", emoji: "🫒", cents: 999 },
  { name: "Cast-iron skillet", detail: "12-inch, pre-seasoned", emoji: "🍳", cents: 3499 },
  { name: "Potato chips", detail: "8 oz party bag", emoji: "🥔", cents: 499 },
  { name: "Robot lawn mower", detail: "For a quarter-acre lawn", emoji: "🌱", cents: 89999 },
  { name: "Tortilla chips", detail: "13 oz bag", emoji: "🌮", cents: 449 },
  { name: "Blender", detail: "High-power, 64 oz jar", emoji: "🥤", cents: 9999 },
  { name: "Ground beef", detail: "1 lb, 80% lean", emoji: "🥩", cents: 599 },
  { name: "Carry-on suitcase", detail: "Hard-shell spinner", emoji: "🧳", cents: 12999 },
  { name: "Bottled water", detail: "24-pack of half-litre bottles", emoji: "💧", cents: 599 },
  { name: "Coffee maker", detail: "12-cup drip, programmable", emoji: "☕", cents: 4999 },
  { name: "Cereal", detail: "18 oz box, toasted oats", emoji: "🥣", cents: 499 },
  { name: "Tablet", detail: "10-inch, 64 GB, entry model", emoji: "📱", cents: 34900 },
  { name: "Ketchup", detail: "32 oz squeeze bottle", emoji: "🍅", cents: 399 },
  { name: "Down comforter", detail: "Queen, all-season", emoji: "🛌", cents: 14999 },
  { name: "Salmon fillet", detail: "1 lb, Atlantic", emoji: "🐠", cents: 1199 },
  { name: "Kayak", detail: "10 ft sit-in, recreational", emoji: "🛶", cents: 49999 },
  { name: "Ice cream", detail: "1.5 quart tub, vanilla", emoji: "🍨", cents: 599 },
  { name: "Toaster", detail: "Two-slice", emoji: "🍞", cents: 3499 },
  { name: "Baby wipes", detail: "Pack of 216", emoji: "👶", cents: 1199 },
  { name: "Office chair", detail: "Mesh, adjustable arms", emoji: "🪑", cents: 19999 },
  { name: "Rice", detail: "5 lb bag, long grain", emoji: "🍚", cents: 599 },
  { name: "Instant camera", detail: "With a ten-shot film pack", emoji: "📷", cents: 7999 },
  { name: "Lemons", detail: "2 lb bag", emoji: "🍋", cents: 449 },
  { name: "Vacuum cleaner", detail: "Cordless stick", emoji: "🧹", cents: 29999 },
  { name: "Sparkling water", detail: "12-pack of cans", emoji: "🫧", cents: 599 },
  { name: "Electric kettle", detail: "1.7 litre, stainless steel", emoji: "🫖", cents: 3999 },
  { name: "Chocolate bar", detail: "1.5 oz milk chocolate", emoji: "🍫", cents: 199 },
  { name: "Refrigerator", detail: "French-door, 25 cu ft", emoji: "🧊", cents: 199999 },
  { name: "Maple syrup", detail: "12 oz, pure", emoji: "🥞", cents: 999 },
  { name: "Basketball", detail: "Official size, indoor/outdoor", emoji: "🏀", cents: 2999 },
  { name: "Laundry detergent", detail: "92 oz liquid", emoji: "🫧", cents: 1399 },
  { name: "Acoustic guitar", detail: "Full-size beginner", emoji: "🎸", cents: 19999 },
  { name: "Baby carrots", detail: "1 lb bag", emoji: "🥕", cents: 179 },
  { name: "Tent", detail: "Four-person dome", emoji: "⛺", cents: 14999 },
  { name: "Hot sauce", detail: "5 oz bottle", emoji: "🌶️", cents: 349 },
  { name: "Mountain bike", detail: "Entry hardtail, 29-inch", emoji: "🚵", cents: 69999 },
  { name: "Frozen peas", detail: "12 oz bag", emoji: "🟢", cents: 199 },
  { name: "Hair dryer", detail: "1875 W, ionic", emoji: "💨", cents: 3999 },
  { name: "Mayonnaise", detail: "30 oz jar", emoji: "🥪", cents: 599 },
  { name: "Smartphone", detail: "Flagship, 256 GB", emoji: "📱", cents: 99999 },
  { name: "Mixed nuts", detail: "16 oz can, salted", emoji: "🌰", cents: 899 },
  { name: "Umbrella", detail: "Compact, auto-open", emoji: "☂️", cents: 2499 },
  { name: "Bacon", detail: "12 oz pack", emoji: "🥓", cents: 699 },
  { name: "Treadmill", detail: "Folding, home use", emoji: "🏃", cents: 79999 },
  { name: "Grapes", detail: "2 lb bag, red seedless", emoji: "🍇", cents: 599 },
  { name: "Wall clock", detail: "12-inch, silent sweep", emoji: "🕰️", cents: 1999 },
  { name: "Toilet paper", detail: "12 double rolls", emoji: "🧻", cents: 1199 },
  { name: "Espresso machine", detail: "Semi-automatic with steam wand", emoji: "☕", cents: 59999 },
  { name: "Pasta sauce", detail: "24 oz jar, marinara", emoji: "🍅", cents: 349 },
  { name: "Dumbbells", detail: "Pair of 20 lb, hex rubber", emoji: "🏋️", cents: 5999 },
  { name: "Watermelon", detail: "Whole, seedless", emoji: "🍉", cents: 599 },
  { name: "Noise machine", detail: "White-noise, 20 sounds", emoji: "🔊", cents: 2999 },
  { name: "Popcorn", detail: "Microwave, 6 bags", emoji: "🍿", cents: 449 },
  { name: "Snowblower", detail: "Two-stage, 24-inch, gas", emoji: "❄️", cents: 119999 },
  { name: "Pickles", detail: "24 oz jar, dill spears", emoji: "🥒", cents: 349 },
  { name: "Desk lamp", detail: "LED, adjustable arm", emoji: "💡", cents: 2999 },
  { name: "Flour", detail: "5 lb bag, all-purpose", emoji: "🌾", cents: 399 },
  { name: "Pressure cooker", detail: "Electric multicooker, 6-quart", emoji: "🍲", cents: 9999 },
  { name: "Gum", detail: "Pack of 15 sticks", emoji: "🍬", cents: 199 },
  { name: "E-reader", detail: "6-inch, backlit", emoji: "📖", cents: 10999 },
];
