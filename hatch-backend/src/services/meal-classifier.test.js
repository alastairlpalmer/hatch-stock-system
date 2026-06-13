import { describe, it, expect } from 'vitest';
import { guessFreshMeal, guessMealType, MEAT_BUCKET, VEG_BUCKET } from './meal-classifier.js';

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
});
