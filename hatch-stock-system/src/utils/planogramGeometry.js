// Visual planogram — pure geometry/labelling helpers shared by the admin
// layout editor and the SVG fridge diagram. Mirrors the slot-coding rules in
// hatch-backend/src/services/planogram-layout.js: shelf 1 = top, positions
// 0-based lettered A..Z left to right, so "1A" is top-left.

export function positionLetter(position) {
  if (!Number.isInteger(position) || position < 0 || position >= 26) return '?';
  return String.fromCharCode(65 + position);
}

export function slotCode(shelf, position) {
  return `${shelf}${positionLetter(position)}`;
}

/**
 * Compute SVG geometry for a fridge layout.
 * shelves: [{ shelf, slots }] (any order; rendered top-down by shelf number).
 * Returns { width, height, shelves: [{ shelf, y, slots: [{ position, x, y, width, height, code }] }] }.
 */
export function computeFridgeGeometry(shelves, {
  width = 700,
  shelfHeight = 64,
  shelfGap = 10,
  padding = 16,
  gutter = 22, // left gutter for shelf number labels
  slotGap = 4,
} = {}) {
  const ordered = [...shelves].sort((a, b) => a.shelf - b.shelf);
  const plotW = width - padding * 2 - gutter;
  const rows = [];

  let y = padding;
  for (const s of ordered) {
    const slotW = (plotW - slotGap * (s.slots - 1)) / s.slots;
    const slots = Array.from({ length: s.slots }, (_, position) => ({
      position,
      x: padding + gutter + position * (slotW + slotGap),
      y,
      width: slotW,
      height: shelfHeight,
      code: slotCode(s.shelf, position),
    }));
    rows.push({ shelf: s.shelf, y, slots });
    y += shelfHeight + shelfGap;
  }

  return { width, height: y - shelfGap + padding, shelves: rows };
}

/** Truncate a product name to fit a slot width (rough char budget). */
export function truncateLabel(name, slotWidth, pxPerChar = 6.5) {
  const label = String(name || '');
  const budget = Math.max(3, Math.floor(slotWidth / pxPerChar));
  return label.length <= budget ? label : `${label.slice(0, budget - 1)}…`;
}
