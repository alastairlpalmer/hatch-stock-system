import { useEffect, useState } from 'react';
import invoicesService from '../../../services/invoices.service';

/**
 * How many deliveries have arrived without their invoice being checked.
 *
 * This number is the whole point of the invoices area: reconciliation used to
 * be invisible work — a delivery landed, the paperwork sat in an inbox, and
 * nothing in the system knew the difference between "checked" and "never
 * looked at". Counting it puts it on the hub next to the jobs that already
 * announce themselves.
 *
 * Counted: received POs with no invoice, plus invoices still in draft (logged
 * but not yet accepted). Both are work outstanding; a PO still pending is not
 * — the goods haven't arrived.
 *
 * Fails quiet: a badge is not worth an error state on the hub.
 */
export default function useUninvoicedCount(orders) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const invoices = await invoicesService.getAll({ limit: 200 });
        if (cancelled) return;
        const invoicedOrderIds = new Set(invoices.map((i) => i.orderId).filter(Boolean));
        const receivedUninvoiced = (orders || [])
          .filter((o) => o.status === 'received' && !invoicedOrderIds.has(o.id))
          .length;
        const drafts = invoices.filter((i) => i.status === 'draft').length;
        setCount(receivedUninvoiced + drafts);
      } catch {
        if (!cancelled) setCount(0);
      }
    })();
    return () => { cancelled = true; };
  }, [orders]);

  return count;
}
