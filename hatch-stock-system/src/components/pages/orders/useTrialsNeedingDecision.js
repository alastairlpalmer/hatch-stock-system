import { useEffect, useState } from 'react';
import productTrialsService from '../../../services/productTrials.service';

// Verdicts that represent a real call the operator can act on. `too_early`,
// `no_margin` and `no_sales` are not decisions waiting to be made — they need
// more time, a cost typed in, and a VendLive fix respectively — so none of
// them belongs on a "to decide" badge.
const ACTIONABLE = ['adopt', 'marginal', 'reject'];

/**
 * How many trials have run their course and are waiting on a human.
 *
 * A finished trial nobody decides on is the expensive failure mode: it keeps
 * its facing, keeps appearing on the weekly buy, and keeps costing money at a
 * quantity that was only ever meant to be a test. Surfacing the count on the
 * hub is what stops that.
 *
 * Fails quiet — a badge is not worth an error state on the hub.
 */
export default function useTrialsNeedingDecision() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const trials = await productTrialsService.getAll({ active: '1' });
        if (cancelled) return;
        setCount(trials.filter(
          (t) => t.window?.windowComplete && ACTIONABLE.includes(t.verdict?.verdict),
        ).length);
      } catch {
        if (!cancelled) setCount(0);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return count;
}
