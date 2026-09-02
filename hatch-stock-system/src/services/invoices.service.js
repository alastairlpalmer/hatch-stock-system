import api from './api';

/**
 * Supplier Invoices API Service
 *
 * Closes the buying loop at the money end: what we ORDERED (PO), what TURNED
 * UP (receipts) and what we were CHARGED (invoice), side by side. Reconciling
 * writes the effective unit costs — line discounts and the whole-invoice
 * discount applied — back to the product catalogue and the price trail, so the
 * next buying list prices itself off what we really pay.
 *
 * Invoice shape: { id, orderId, supplierId, invoiceRef, invoiceDate,
 *   goodsTotal, orderDiscount, deliveryCharge, vat, invoiceTotal,
 *   spreadDelivery, status: 'draft'|'reconciled', notes, reconciledAt,
 *   reconciledBy, lines: [line], supplier, order }
 * Line shape: { id, sku, rawCode, rawName, quantity, unitPrice, lineDiscount,
 *   lineTotal, effectiveUnitCost, matchedBy }
 */
export const invoicesService = {
  /**
   * Parse a pasted invoice table (CSV / TSV / spreadsheet paste) and match its
   * lines to the catalogue. Saves nothing — this is the preview the operator
   * checks before creating the invoice.
   *
   * Supplying supplierId scopes matching to that supplier's products, which is
   * what makes their own product codes usable as identity.
   *
   * @param {string} text raw pasted table
   * @param {string} [supplierId]
   * @returns {Promise<{ lines, headerRow, skipped, warnings, matched, unmatched }>}
   *   each line: { rawCode, rawName, quantity, unitPrice, lineDiscount,
   *   lineTotal, sku, matchedBy, confidence: 'exact'|'likely'|'none',
   *   candidates: [{ sku, name, score }], currentUnitCost }
   */
  parse: async (text, supplierId = null) => {
    const response = await api.post('/invoices/parse', {
      text,
      ...(supplierId ? { supplierId } : {}),
    });
    return response.data;
  },

  /** @param {Object} filters - { status?, supplierId?, orderId?, limit? } */
  getAll: async (filters = {}) => {
    const response = await api.get('/invoices', { params: filters });
    return response.data;
  },

  /**
   * One invoice WITH its reconciliation against the linked PO:
   * { ...invoice, reconciliation: { rows, totals, counts } }.
   * rows: one per SKU — { sku, name, kind: 'both'|'invoiceOnly'|'orderOnly',
   *   orderedQty, receivedQty, invoicedQty, compareQty, compareBasis,
   *   expectedUnitPrice, invoicedUnitCost, qtyVariance, priceVariance,
   *   priceVariancePct, valueVariance, flags, ok }
   */
  getById: async (id) => {
    const response = await api.get(`/invoices/${id}`);
    return response.data;
  },

  /** @param {Object} invoice - { orderId?, supplierId?, invoiceRef, invoiceDate?, totals…, lines } */
  create: async (invoice) => {
    const response = await api.post('/invoices', invoice);
    return response.data;
  },

  /** Draft only. `lines` replaces the whole grid when supplied. */
  update: async (id, updates) => {
    const response = await api.put(`/invoices/${id}`, updates);
    return response.data;
  },

  delete: async (id) => {
    const response = await api.delete(`/invoices/${id}`);
    return response.data;
  },

  /**
   * Accept the invoice as the truth about what we paid: writes invoicedQty /
   * invoicedUnitPrice onto the PO lines, appends price_history for every cost
   * that MOVED, updates products.unitCost (and locks it against the VendLive
   * catalog sync), and learns supplier product codes from hand-matched lines.
   *
   * @param {string} id
   * @param {Object} [opts] - { reconciledBy?, updateCosts? } — updateCosts
   *   false records the invoice without resetting standing costs (a one-off
   *   promo price, a sample order).
   * @returns {Promise<{ invoice, priceChanges, orderLinesUpdated, codesLearned }>}
   */
  reconcile: async (id, opts = {}) => {
    const response = await api.post(`/invoices/${id}/reconcile`, opts);
    return response.data;
  },

  /**
   * Reopen a reconciled invoice for editing. Does NOT roll back the costs it
   * wrote — the payment happened; correcting a mistake means fixing the
   * invoice and reconciling again, which appends the correction to the trail.
   */
  unreconcile: async (id) => {
    const response = await api.post(`/invoices/${id}/unreconcile`);
    return response.data;
  },

  /** Cost trail for one SKU, newest first. */
  priceHistory: async (sku, limit = 24) => {
    const response = await api.get(`/invoices/price-history/${encodeURIComponent(sku)}`, {
      params: { limit },
    });
    return response.data;
  },
};

export default invoicesService;
