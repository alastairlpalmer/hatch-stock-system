import { describe, it, expect } from 'vitest';
import { categoryIsFreshMeal, guessFreshMeal, guessMealType, MEAT_BUCKET, VEG_BUCKET } from './meal-classifier.js';
import { FRESH_MEAL_PLACEHOLDER_CATEGORY } from '../utils/fresh-meal-placeholders.js';

describe('guessMealType', () => {
  it('classifies meat dishes as Meat', () => {
    expect(guessMealType('Frive Chicken Tikka Masala')).toBe(MEAT_BUCKET);
    expect(guessMealType('Beef Lasagne')).toBe(MEAT_BUCKET);
    expect(guessMealType('Salmon & Dill Risotto')).toBe(MEAT_BUCKET);
  });

  it('classifies veg/vegan dishes as Veg/Vegan, even with a meaty-sounding name', () => {
    expect(guessMealType('Vegan Tikka Masala')).toBe(VEG_BUCKET);
    expect(guessMealType('Chickpea & Spinach Curry')).toBe(VEG_BUCKET);
    expect(guessMealType('Plant-Based Bolognese')).toBe(VEG_BUCKET);
  });

  it('returns null when ambiguous', () => {
    expect(guessMealType('Frive Weekly Special')).toBeNull();
    expect(guessMealType('')).toBeNull();
    expect(guessMealType(undefined)).toBeNull();
  });

  it('does not match keywords embedded in unrelated words', () => {
    // "hambone" / "beefeater" style false positives must not trigger
    expect(guessMealType('Beefeater Gin Snack')).toBeNull();
  });
});

describe('guessFreshMeal', () => {
  it('flags fresh meals from meal-type keywords', () => {
    expect(guessFreshMeal('Chicken Korma')).toEqual({ isFreshMeal: true, mealType: MEAT_BUCKET });
    expect(guessFreshMeal('Falafel Wrap Bowl')).toEqual({ isFreshMeal: true, mealType: VEG_BUCKET });
  });

  it('flags fresh meals from dish keywords even when the bucket is ambiguous', () => {
    const r = guessFreshMeal('Frive Weekly Risotto');
    expect(r.isFreshMeal).toBe(true);
    expect(r.mealType).toBeNull();
  });

  it('honours an explicit Frive supplier hint', () => {
    const r = guessFreshMeal('Mystery Box', { supplierIsFrive: true });
    expect(r.isFreshMeal).toBe(true);
    expect(r.mealType).toBeNull();
  });

  it('leaves ordinary products untouched', () => {
    expect(guessFreshMeal('Barebells Milkshake - Chocolate')).toEqual({ isFreshMeal: false, mealType: null });
    expect(guessFreshMeal('MOMA Porridge Pot - Berry')).toEqual({ isFreshMeal: false, mealType: null });
    expect(guessFreshMeal('Coca-Cola 330ml')).toEqual({ isFreshMeal: false, mealType: null });
  });

  it('flags fresh meals from a "Fresh Meals" category even when no name keyword matches', () => {
    // Weekly-rotating flavours often have no recognisable dish word — the
    // VendLive category is the signal that survives the menu churn.
    expect(guessFreshMeal('Frive Katsu Bowl', { category: 'Fresh Meals' }))
      .toEqual({ isFreshMeal: true, mealType: null });
    expect(guessFreshMeal('Bulgogi Bowl', { category: 'fresh meals' }))
      .toEqual({ isFreshMeal: true, mealType: null });
    expect(guessFreshMeal('Bulgogi Bowl', { category: 'FRESH MEALS (FRIVE)' }))
      .toEqual({ isFreshMeal: true, mealType: null });
  });

  it('still guesses the bucket from the name when the category flags it', () => {
    expect(guessFreshMeal('Firecracker Chicken Thighs', { category: 'Fresh Meals' }))
      .toEqual({ isFreshMeal: true, mealType: MEAT_BUCKET });
    expect(guessFreshMeal('Bulgogi Vegan Beef Bowl', { category: 'Fresh Meals' }))
      .toEqual({ isFreshMeal: true, mealType: VEG_BUCKET });
  });

  it('ignores non-fresh-meal categories', () => {
    expect(guessFreshMeal('Coca-Cola 330ml', { category: 'Drinks' }))
      .toEqual({ isFreshMeal: false, mealType: null });
    expect(guessFreshMeal('Coca-Cola 330ml', { category: null }))
      .toEqual({ isFreshMeal: false, mealType: null });
  });

  it('never flags the ordering placeholder category', () => {
    // Placeholders (FRIVE-MEAT etc.) must stay isFreshMeal = false so they
    // never join the fresh-meal group aggregation.
    expect(categoryIsFreshMeal(FRESH_MEAL_PLACEHOLDER_CATEGORY)).toBe(false);
    expect(guessFreshMeal('Some Placeholder', { category: FRESH_MEAL_PLACEHOLDER_CATEGORY }))
      .toEqual({ isFreshMeal: false, mealType: null });
  });
});

describe('categoryIsFreshMeal', () => {
  it('matches the VendLive category in its variants', () => {
    expect(categoryIsFreshMeal('Fresh Meals')).toBe(true);
    expect(categoryIsFreshMeal('Fresh Meal')).toBe(true);
    expect(categoryIsFreshMeal(' fresh meals ')).toBe(true);
    expect(categoryIsFreshMeal('Fresh Meals (Frive)')).toBe(true);
  });

  it('rejects everything else', () => {
    expect(categoryIsFreshMeal('Fresh Meal Order')).toBe(false); // ordering placeholders
    expect(categoryIsFreshMeal('Freshly Squeezed Juice')).toBe(false);
    expect(categoryIsFreshMeal('Meals')).toBe(false);
    expect(categoryIsFreshMeal(null)).toBe(false);
    expect(categoryIsFreshMeal(undefined)).toBe(false);
    expect(categoryIsFreshMeal('')).toBe(false);
  });
});
