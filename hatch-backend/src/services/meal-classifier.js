/**
 * Frive fresh-meal classifier.
 *
 * Single source of the name-based heuristic that guesses, on every product
 * CREATION path (VendLive auto-create, CSV/sales import, screenshot import),
 * whether a product is a Frive fresh meal and which meal-type bucket it belongs
 * to. Guesses are always written with mealTypeConfirmed = false so a human
 * confirms them in the Fresh Meals review queue before they are trusted.
 *
 * Pure and synchronous (no DB) so it is trivially unit-testable and safe to call
 * inside hot ingest loops.
 *
 * The returned bucket names ("Meat", "Veg/Vegan") match the seeded meal_types
 * rows. If an operator renames a bucket the guess may not match a live row —
 * that is fine: the value still surfaces in the review queue for a human to
 * correct, and confirmed values are never overwritten by re-classification.
 */

export const MEAT_BUCKET = 'Meat';
export const VEG_BUCKET = 'Veg/Vegan';

// VendLive files Frive flavours under a "Fresh Meals" category — the strongest
// signal available, since it survives weekly menu churn that name keywords
// miss. The ordering placeholders ("Fresh Meal Order", see
// utils/fresh-meal-placeholders.js) must NEVER match: they are deliberately
// isFreshMeal = false so they stay out of group aggregation.
const FRESH_MEAL_CATEGORY_PATTERN = /^fresh\s*meals?(\s*\(.*\))?$/i;

/** Whether a raw category name marks a product as a Frive fresh meal. */
export function categoryIsFreshMeal(category) {
  return FRESH_MEAL_CATEGORY_PATTERN.test(String(category || '').trim());
}

// Veg/Vegan wins ties (e.g. "Vegan Tikka" mentions no meat but a meaty-sounding
// dish name shouldn't misclassify an explicitly vegan meal), so it is checked
// first. Word-boundary matching avoids "beefy" substrings inside unrelated words.
const VEG_KEYWORDS = [
  'vegan', 'veggie', 'vegetarian', 'plant', 'plant-based', 'meat-free', 'meatless',
  'tofu', 'chickpea', 'lentil', 'dahl', 'dhal', 'daal', 'falafel', 'halloumi',
  'paneer', 'jackfruit', 'quorn', 'aubergine', 'mushroom', 'spinach', 'bean',
];

const MEAT_KEYWORDS = [
  'chicken', 'beef', 'pork', 'lamb', 'meatball', 'bolognese', 'bolognaise',
  'chorizo', 'bacon', 'ham', 'turkey', 'duck', 'sausage', 'steak', 'mince',
  'fish', 'salmon', 'tuna', 'cod', 'haddock', 'prawn', 'shrimp', 'seafood',
];

// Signals that a product is a Frive fresh meal at all (in addition to the
// supplier hint the caller can pass). Deliberately conservative — non-meal
// products must stay isFreshMeal = false so the rest of the app is unchanged.
const FRESH_MEAL_KEYWORDS = [
  'frive', 'curry', 'tikka', 'masala', 'korma', 'bolognese', 'bolognaise',
  'lasagne', 'lasagna', 'risotto', 'stew', 'casserole', 'tagine', 'biryani',
  'chilli', 'chili', 'stir fry', 'stir-fry', 'noodle', 'pasta', 'paella',
  'shepherd', 'cottage pie', 'hotpot', 'goulash', 'dahl', 'dhal', 'daal',
];

function hasKeyword(haystack, keywords) {
  for (const kw of keywords) {
    // Escape regex metacharacters in the keyword, then match on word boundaries.
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, 'i');
    if (pattern.test(haystack)) return true;
  }
  return false;
}

/**
 * Guess the meal-type bucket from a name. Returns "Meat", "Veg/Vegan", or null
 * (ambiguous — needs human confirm). Exported for reuse/testing.
 */
export function guessMealType(name) {
  const text = ` ${String(name || '').toLowerCase()} `;
  if (hasKeyword(text, VEG_KEYWORDS)) return VEG_BUCKET;
  if (hasKeyword(text, MEAT_KEYWORDS)) return MEAT_BUCKET;
  return null;
}

/**
 * Decide whether a product is a Frive fresh meal, and its bucket.
 *
 * @param {string} name
 * @param {{ supplierIsFrive?: boolean, category?: string|null }} [opts]
 *   - supplierIsFrive: caller passes true when it knows preferredSupplierId
 *     resolves to the Frive supplier.
 *   - category: the raw (VendLive) category name — a "Fresh Meals" category is
 *     a definitive signal that beats name keywords, so brand-new flavours with
 *     no recognisable dish word (e.g. "Katsu Bowl") still classify.
 * @returns {{ isFreshMeal: boolean, mealType: string|null }}
 */
export function guessFreshMeal(name, { supplierIsFrive = false, category = null } = {}) {
  const text = ` ${String(name || '').toLowerCase()} `;
  const mealType = guessMealType(name);
  // A meal-type keyword or a fresh-meal dish keyword, an explicit Frive
  // supplier, OR the VendLive "Fresh Meals" category marks it as a fresh meal.
  // mealType alone (e.g. "chicken") is a strong enough signal on its own.
  const isFreshMeal =
    supplierIsFrive ||
    categoryIsFreshMeal(category) ||
    mealType != null ||
    hasKeyword(text, FRESH_MEAL_KEYWORDS);
  return {
    isFreshMeal,
    mealType: isFreshMeal ? mealType : null,
  };
}
