import { localDay } from './helpers';

/**
 * Roll per-SKU sales rows up into the same groups the rest of the app uses:
 *
 *  - Product families: flavours linked by parentId collapse into one row
 *    named after the parent ("Barebells Milkshake").
 *  - Frive fresh meals: isFreshMeal SKUs collapse into their meal-type bucket
 *    ("Frive Beef"), or "Frive (unclassified)" when no bucket is set — the
 *    same effective category the backend uses for category rollups.
 *  - Everything else stays a standalone per-SKU row.
 *
 * Group totals sum members; margin is recomputed on the summed basis, never
 * averaged. Output rows share one shape so the table can render them alike:
 * { key, name, category, isGroup, kind, memberCount, units, revenue, cost, members }
 *
 * rows: [{ sku, name, category, units, revenue, cost,
 *          parentId?, parentName?, isFreshMeal?, mealType? }]
 */
export function groupProductRows(rows) {
  const groups = new Map();
  const out = [];

  for (const r of rows || []) {
    let key = null;
    let name = null;
    let kind = null;
    if (r.isFreshMeal) {
      kind = 'meal';
      name = r.mealType ? `Frive ${r.mealType}` : 'Frive (unclassified)';
      key = `meal:${r.mealType || ''}`;
    } else if (r.parentId) {
      kind = 'family';
      name = r.parentName || 'Product family';
      key = `family:${r.parentId}`;
    }

    if (!key) {
      out.push({
        key: `sku:${r.sku}`,
        sku: r.sku,
        name: r.name,
        category: r.category || 'Other',
        isGroup: false,
        kind: null,
        memberCount: 1,
        units: r.units || 0,
        revenue: r.revenue || 0,
        cost: r.cost || 0,
        members: [],
      });
      continue;
    }

    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        name,
        category: null,
        isGroup: true,
        kind,
        memberCount: 0,
        units: 0,
        revenue: 0,
        cost: 0,
        members: [],
        _categories: new Map(),
      };
      groups.set(key, g);
      out.push(g);
    }
    g.members.push({
      sku: r.sku,
      name: r.name,
      category: r.category || 'Other',
      units: r.units || 0,
      revenue: r.revenue || 0,
      cost: r.cost || 0,
    });
    g.memberCount += 1;
    g.units += r.units || 0;
    g.revenue += r.revenue || 0;
    g.cost += r.cost || 0;
    const cat = r.category || 'Other';
    g._categories.set(cat, (g._categories.get(cat) || 0) + 1);
  }

  // A group's category is its members' most common one (a family is still
  // "Snacks" etc.); fresh-meal buckets read as Fresh Meals regardless.
  for (const g of groups.values()) {
    if (g.kind === 'meal') {
      g.category = 'Fresh Meals';
    } else {
      let best = 'Other';
      let bestN = -1;
      for (const [cat, n] of g._categories) {
        if (n > bestN) { best = cat; bestN = n; }
      }
      g.category = best;
    }
    delete g._categories;
    g.members.sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name));
  }

  return out;
}

/** Profit and margin % for any row with revenue/cost. */
export function rowProfit(row) {
  const profit = (row.revenue || 0) - (row.cost || 0);
  const margin = row.revenue > 0 ? (profit / row.revenue) * 100 : 0;
  return { profit, margin };
}

/**
 * Quick date-range presets for the sales filters. All ranges are inclusive
 * YYYY-MM-DD strings in the device's local calendar (the backend widens a
 * date-only end to the whole day). "This week" starts on Monday — the Hatch
 * sales week runs Mon–Fri.
 */
export const DATE_PRESETS = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'last7', label: 'Last 7 days' },
  { id: 'month', label: 'This month' },
];

export function datePresetRange(id, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = localDay(today);
  const start = new Date(today);
  switch (id) {
    case 'today':
      break;
    case 'week': {
      // getDay(): 0 = Sunday … 6 = Saturday → days back to Monday
      const back = (today.getDay() + 6) % 7;
      start.setDate(start.getDate() - back);
      break;
    }
    case 'last7':
      start.setDate(start.getDate() - 6);
      break;
    case 'month':
      start.setDate(1);
      break;
    default:
      return null;
  }
  return { start: localDay(start), end };
}
