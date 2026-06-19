import type { SettlementRow, MTRRow, SettlementSummary, ConsolidatedRowInput } from '../../types';

// --- Constants ---

/** Price types that map to TCS charges */
const TCS_PRICE_TYPES = ['TCS-IGST', 'TCS-CGST', 'TCS-SGST', 'TCS-UTGST'] as const;

/** Price type for TDS Section 194-O */
const TDS_PRICE_TYPE = 'TDS (Section 194-O)';

/**
 * NOTE: Promo amounts come from 'promotion-amount' column, NOT 'other-amount'.
 * The 'other-amount' column is always empty for promo rows.
 */
const PROMO_AMOUNT_COLUMN = 'promotion-amount' as const;

/**
 * Round a number to 2 decimal places.
 */
function round2(val: number): number {
  if (val === null || val === undefined || isNaN(val) || !isFinite(val)) return 0;
  // NUMERIC(14,2) maximum is 999999999999.99
  if (val > 999999999999) return 999999999999.99;
  if (val < -999999999999) return -999999999999.99;
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

/**
 * Step 3 — Aggregate settlement rows per order.
 * Groups by order-id and computes charges, TCS, TDS, promos.
 */
export function aggregateSettlement(
  settlementRows: SettlementRow[],
  depositDateMap: Map<string, string>
): Map<string, SettlementSummary> {
  const summaryMap = new Map<string, SettlementSummary>();

  for (const row of settlementRows) {
    const orderId = String(row['order-id'] ?? '').trim();
    if (!orderId) continue;

    const settlementId = String(row['settlement-id'] ?? '').trim();

    if (!summaryMap.has(orderId)) {
      summaryMap.set(orderId, {
        orderId,
        charges: 0,
        tcsIgst: 0,
        tds: 0,
        promos: 0,
        settlementId,
        depositDate: depositDateMap.get(settlementId) ?? '',
      });
    }

    const summary = summaryMap.get(orderId)!;

    // Charges: sum of item-related-fee-amount where non-zero
    const feeAmount = row['item-related-fee-amount'] as number;
    if (!isNaN(feeAmount) && feeAmount !== 0) {
      summary.charges += feeAmount;
    }

    // TCS: sum of price-amount where price-type in TCS_PRICE_TYPES
    const priceType = String(row['price-type'] ?? '').trim();
    const priceAmount = row['price-amount'] as number;
    if (
      !isNaN(priceAmount) &&
      (TCS_PRICE_TYPES as ReadonlyArray<string>).includes(priceType)
    ) {
      summary.tcsIgst += priceAmount;
    }

    // TDS: sum of price-amount where price-type === TDS_PRICE_TYPE
    if (!isNaN(priceAmount) && priceType === TDS_PRICE_TYPE) {
      summary.tds += priceAmount;
    }

    // Promos: sum of promotion-amount where promotion-type is non-empty
    // CRITICAL: Use promotion-amount, NOT other-amount
    const promoType = String(row['promotion-type'] ?? '').trim();
    const promoAmount = row[PROMO_AMOUNT_COLUMN] as number;
    if (!isNaN(promoAmount) && promoType !== '') {
      summary.promos += promoAmount;
    }
  }

  return summaryMap;
}

/**
 * Step 4 — Join MTR rows with settlement summaries + proportional split.
 * Left join: MTR ← SettlementSummary on Order Id = orderId.
 * For multi-invoice orders, splits charges proportionally by invoice amount.
 */
export function consolidate(
  mtrRows: MTRRow[],
  summaryMap: Map<string, SettlementSummary>,
  periodId: string,
  warnings: string[]
): ConsolidatedRowInput[] {
  // Group MTR rows by Order Id to detect multi-invoice orders
  const orderGroups = new Map<string, MTRRow[]>();
  for (const row of mtrRows) {
    const orderId = String(row['Order Id'] ?? '').trim();
    if (!orderGroups.has(orderId)) {
      orderGroups.set(orderId, []);
    }
    orderGroups.get(orderId)!.push(row);
  }

  const results: ConsolidatedRowInput[] = [];

  for (const [orderId, rows] of orderGroups.entries()) {
    const settlement = summaryMap.get(orderId);

    if (!settlement && orderId) {
      warnings.push(`⚠️ Order ${orderId} has no matching settlement data — charges will be 0`);
    }

    // Compute total invoice amount for this order (for proportional split)
    const orderInvoiceTotal = rows.reduce(
      (sum, r) => sum + (r['Invoice Amount'] as number || 0),
      0
    );

    let cancelCounter = 1;
    for (const mtrRow of rows) {
      const invoiceAmount = mtrRow['Invoice Amount'] as number || 0;

      // Proportional weight
      let weight: number;
      if (rows.length === 1) {
        weight = 1.0;
      } else if (Math.abs(orderInvoiceTotal) < 0.01) {
        // Division by zero guard: set weight to 0
        weight = 0;
      } else {
        weight = invoiceAmount / orderInvoiceTotal;
      }

      const charges = settlement ? round2(settlement.charges * weight) : 0;
      const tcsIgst = settlement ? round2(settlement.tcsIgst * weight) : 0;
      const tds = settlement ? round2(settlement.tds * weight) : 0;
      const promos = settlement ? round2(settlement.promos * weight) : 0;

      const total = round2(invoiceAmount + charges + tcsIgst + tds + promos);

      const rawInvoiceNo = String(mtrRow['Invoice Number'] ?? '').trim();
      const invoiceNo = rawInvoiceNo || `CANCEL-${orderId || 'UNKNOWN'}-${cancelCounter++}`;

      results.push({
        period_id: periodId,
        seller_gstn: mtrRow['Seller Gstin'] || null,
        invoice_no: invoiceNo,
        invoice_date: String(mtrRow['Invoice Date'] ?? '').trim() || null,
        transaction_type: String(mtrRow['Transaction Type'] ?? '').trim() || null,
        order_id: orderId || null,
        order_date: String(mtrRow['Order Date'] ?? '').trim() || null,
        item_description: String(mtrRow['Item Description'] ?? '').trim() || null,
        sku: String(mtrRow['Sku'] ?? '').trim() || null,
        quantity: (mtrRow['Quantity'] as number) ?? null,
        tax_exclusive_amount: mtrRow['Tax Exclusive Gross'] !== undefined ? round2(mtrRow['Tax Exclusive Gross'] as number) : null,
        total_tax_amount: mtrRow['Total Tax Amount'] !== undefined ? round2(mtrRow['Total Tax Amount'] as number) : null,
        invoice_amount: round2(invoiceAmount),
        charges,
        tcs_igst: tcsIgst,
        tds,
        promos,
        total,
        settlement_id: settlement?.settlementId ?? null,
        deposit_date: settlement?.depositDate ?? null,
        payment_type: null, // enriched later
        fulfillment_channel: null, // enriched later
        type: (mtrRow.type as string) || 'B2C',
      });
    }
  }

  // REMOVED invoice_no uniqueness filter, as multi-item orders legitimately share the same invoice number.
  // Dropping them was causing significant revenue underreporting.
  return results;
}
