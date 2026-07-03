// Placeholder products for ORDERING fresh meals at the meal-type level.
//
// The Frive menu rotates every week, so a Wednesday PO cannot name the actual
// flavour SKUs that will arrive at the weekend — the operator orders "40 Meat
// meals". Buying lists therefore keep fresh meals as meal-type group lines,
// and POs (whose items require a real product FK) use one auto-managed
// placeholder product per meal type. At receiving, the placeholder line is
// allocated to the ACTUAL flavour SKUs found in the box (see the `forSku`
// receive payload field), so batches/expiry/FEFO always track real products.
//
// Placeholders are deliberately NOT isFreshMeal — they must never join the
// fresh-meal group aggregation in suggestions or pick lists. They are
// identified by this category.
export const FRESH_MEAL_PLACEHOLDER_CATEGORY = 'Fresh Meal Order';

export function placeholderSkuFor(mealType) {
  const slug = String(mealType)
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toUpperCase();
  return `FRIVE-${slug || 'MEAL'}`;
}

/**
 * Ensure a placeholder product exists per meal type. Returns
 * { [mealType]: sku }. Accepts a prisma client or transaction.
 */
export async function ensureFreshMealPlaceholders(db, mealTypes) {
  const map = {};
  for (const mealType of mealTypes) {
    const sku = placeholderSkuFor(mealType);
    await db.product.upsert({
      where: { sku },
      create: {
        sku,
        name: `Frive — ${mealType} (weekly rotating)`,
        category: FRESH_MEAL_PLACEHOLDER_CATEGORY,
        // mealType is recorded so receiving can offer the right flavour list;
        // isFreshMeal stays false (see header comment).
        mealType,
        isFreshMeal: false,
        unitsPerBox: 1,
      },
      update: {}, // existing placeholder is left untouched
    });
    map[mealType] = sku;
  }
  return map;
}
