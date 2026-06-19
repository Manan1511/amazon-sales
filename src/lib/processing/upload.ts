import { supabase } from '../supabase';
import type { ConsolidatedRowInput, SettlementFeeInput, SettlementRow, SettlementSummary } from '../../types';

/** Batch size for inserts to avoid payload limits */
const BATCH_SIZE = 500;

/** Fee type for advertising costs */
const ADVERTISING_FEE_TYPE = 'Cost of Advertising';

/**
 * Round a number to 2 decimal places.
 */
function round2(val: number): number {
  if (val === null || val === undefined || isNaN(val) || !isFinite(val)) return 0;
  if (val > 999999999999) return 999999999999.99;
  if (val < -999999999999) return -999999999999.99;
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

export type ProgressCallback = (step: string, percent: number, log?: string) => void;

/**
 * Step 6 — Build settlement fee records from raw settlement rows.
 * Includes all rows where item-related-fee-amount !== 0.
 */
export function buildFeeRecords(
  settlementRows: SettlementRow[],
  periodId: string
): SettlementFeeInput[] {
  const fees: SettlementFeeInput[] = [];

  for (const row of settlementRows) {
    const feeAmount = row['item-related-fee-amount'] as number;
    const feeType = String(row['item-related-fee-type'] ?? '').trim();
    const orderId = String(row['order-id'] ?? '').trim() || null;
    const sku = String(row['sku'] ?? '').trim() || null;

    // Include fee rows and advertising rows
    if ((!isNaN(feeAmount) && feeAmount !== 0) || feeType === ADVERTISING_FEE_TYPE) {
      fees.push({
        period_id: periodId,
        order_id: orderId,
        sku,
        fee_type: feeType || 'Unknown',
        fee_amount: feeAmount || 0,
      });
    }
  }

  return fees;
}

export interface UploadResult {
  periodId: string;
  invoicesReconciled: number;
  settlementsReconciled: number;
  placeholdersCreated: number;
}

/**
 * Step 7 — Upload consolidated records and fees to Supabase.
 * Uses upsert with conflict handling and batch inserts.
 * Performs two-way cross-period reconciliation for unmatched invoices & settlements.
 */
export async function uploadToSupabase(
  month: string,
  year: number,
  consolidatedRows: ConsolidatedRowInput[],
  feeRows: SettlementFeeInput[],
  summaryMap: Map<string, SettlementSummary>,
  onProgress: ProgressCallback
): Promise<UploadResult> {
  // Step 7.1 — Upsert period
  onProgress('Upserting period record...', 5, `Upserting period: ${month} ${year}`);

  const { data: periodData, error: periodError } = await supabase
    .from('periods')
    .upsert({ month, year }, { onConflict: 'month,year' })
    .select('id')
    .single();

  if (periodError || !periodData) {
    throw new Error(`Failed to upsert period: ${periodError?.message ?? 'No data returned'}`);
  }

  const periodId = periodData.id as string;
  onProgress('Period record saved.', 10, `Period ID: ${periodId}`);

  // Update period_id in all rows
  const recordsWithPeriod = consolidatedRows.map((r) => ({ ...r, period_id: periodId }));
  const feesWithPeriod = feeRows.map((f) => ({ ...f, period_id: periodId }));

  // ---- TWO-WAY CROSS-MONTH RECONCILIATION ----
  
  // 1. Identify unmatched settlements & unmatched MTR records in this upload
  const uploadedMtrOrderIds = new Set(
    recordsWithPeriod.map((r) => r.order_id).filter(Boolean) as string[]
  );
  const unmatchedSettlements = [...summaryMap.values()].filter(
    (s) => !uploadedMtrOrderIds.has(s.orderId)
  );

  const unmatchedMtrRows = recordsWithPeriod.filter((r) => !r.settlement_id);
  const unmatchedMtrOrderIds = Array.from(
    new Set(unmatchedMtrRows.map((r) => r.order_id).filter(Boolean) as string[])
  );

  const deletedSettlementOnlyIds: string[] = [];

  // Phase A: Match incoming MTR rows with SETTLEMENT-ONLY records in DB
  let mtrRowsResolved = 0;
  if (unmatchedMtrOrderIds.length > 0) {
    onProgress('Reconciling with database settlements...', 12, 'Checking database for previous settlements...');
    
    // Chunk queries to avoid Supabase URL length limits
    const CHUNK_SIZE = 300;
    const dbSettlements: any[] = [];
    for (let i = 0; i < unmatchedMtrOrderIds.length; i += CHUNK_SIZE) {
      const chunk = unmatchedMtrOrderIds.slice(i, i + CHUNK_SIZE);
      const { data, error } = await supabase
        .from('consolidated_records')
        .select('id, order_id, charges, tcs_igst, tds, promos, settlement_id, deposit_date')
        .in('order_id', chunk)
        .like('invoice_no', 'SETTLEMENT-ONLY-%');
        
      if (!error && data) {
        dbSettlements.push(...data);
      }
    }

    if (dbSettlements.length > 0) {
      const dbSettlementsMap = new Map<string, typeof dbSettlements[0]>();
      for (const ds of dbSettlements) {
        if (ds.order_id) {
          dbSettlementsMap.set(ds.order_id, ds);
          deletedSettlementOnlyIds.push(ds.id);
        }
      }

      // Enrich the records about to be inserted
      for (const row of recordsWithPeriod) {
        if (row.order_id && dbSettlementsMap.has(row.order_id)) {
          const ds = dbSettlementsMap.get(row.order_id)!;
          const siblingCount = recordsWithPeriod.filter((r) => r.order_id === row.order_id).length;
          
          let weight = 1;
          if (siblingCount > 1) {
            const orderInvoiceTotal = recordsWithPeriod
              .filter((r) => r.order_id === row.order_id)
              .reduce((sum, r) => sum + (r.invoice_amount ?? 0), 0);
            weight = orderInvoiceTotal > 0 ? (row.invoice_amount ?? 0) / orderInvoiceTotal : 0;
          }

          row.charges = round2((ds.charges ?? 0) * weight);
          row.tcs_igst = round2((ds.tcs_igst ?? 0) * weight);
          row.tds = round2((ds.tds ?? 0) * weight);
          row.promos = round2((ds.promos ?? 0) * weight);
          row.settlement_id = ds.settlement_id;
          row.deposit_date = ds.deposit_date;
          row.total = round2((row.invoice_amount ?? 0) + row.charges + row.tcs_igst + row.tds + row.promos);
          mtrRowsResolved++;
        }
      }
    }
  }

  // Phase B: Match incoming settlements with MTR records in DB or create SETTLEMENT-ONLY records
  const updatedRecords: Array<{
    id: string;
    charges: number;
    tcs_igst: number;
    tds: number;
    promos: number;
    total: number;
    settlement_id: string;
    deposit_date: string;
  }> = [];
  const unmatchedSettlementsToInsert: ConsolidatedRowInput[] = [];

  if (unmatchedSettlements.length > 0) {
    onProgress('Reconciling with database invoices...', 14, 'Checking database for previous invoices...');
    const unmatchedSettlementOrderIds = unmatchedSettlements.map((s) => s.orderId);

    const CHUNK_SIZE = 300;
    const dbMtrRows: any[] = [];
    for (let i = 0; i < unmatchedSettlementOrderIds.length; i += CHUNK_SIZE) {
      const chunk = unmatchedSettlementOrderIds.slice(i, i + CHUNK_SIZE);
      const { data, error } = await supabase
        .from('consolidated_records')
        .select('id, order_id, invoice_amount')
        .in('order_id', chunk)
        .not('invoice_no', 'like', 'SETTLEMENT-ONLY-%');
        
      if (!error && data) {
        dbMtrRows.push(...data);
      }
    }

    if (dbMtrRows.length > 0) {
      const dbMtrMap = new Map<string, typeof dbMtrRows>();
      for (const dr of dbMtrRows) {
        if (dr.order_id) {
          const list = dbMtrMap.get(dr.order_id) ?? [];
          list.push(dr);
          dbMtrMap.set(dr.order_id, list);
        }
      }

      for (const settlement of unmatchedSettlements) {
        if (dbMtrMap.has(settlement.orderId)) {
          const rows = dbMtrMap.get(settlement.orderId)!;
          const orderInvoiceTotal = rows.reduce((sum, r) => sum + (r.invoice_amount ?? 0), 0);

          for (const mtrRow of rows) {
            let weight = 1;
            if (rows.length > 1) {
              weight = orderInvoiceTotal > 0 ? (mtrRow.invoice_amount ?? 0) / orderInvoiceTotal : 0;
            }

            const charges = round2(settlement.charges * weight);
            const tcsIgst = round2(settlement.tcsIgst * weight);
            const tds = round2(settlement.tds * weight);
            const promos = round2(settlement.promos * weight);
            const total = round2((mtrRow.invoice_amount ?? 0) + charges + tcsIgst + tds + promos);

            updatedRecords.push({
              id: mtrRow.id,
              charges,
              tcs_igst: tcsIgst,
              tds,
              promos,
              total,
              settlement_id: settlement.settlementId,
              deposit_date: settlement.depositDate,
            });
          }
        } else {
          // No MTR row in DB, insert a settlement-only placeholder record
          unmatchedSettlementsToInsert.push({
            period_id: periodId,
            seller_gstn: null,
            invoice_no: `SETTLEMENT-ONLY-${settlement.orderId}`,
            invoice_date: null,
            transaction_type: null,
            order_id: settlement.orderId,
            order_date: null,
            item_description: null,
            sku: null,
            quantity: 0,
            tax_exclusive_amount: 0,
            total_tax_amount: 0,
            invoice_amount: 0,
            charges: settlement.charges,
            tcs_igst: settlement.tcsIgst,
            tds: settlement.tds,
            promos: settlement.promos,
            total: round2(settlement.charges + settlement.tcsIgst + settlement.tds + settlement.promos),
            settlement_id: settlement.settlementId,
            deposit_date: settlement.depositDate,
            payment_type: null,
            fulfillment_channel: null,
            type: 'B2C',
          });
        }
      }
    } else {
      // None of the unmatched settlements have matching invoices in the DB yet, create placeholders
      for (const settlement of unmatchedSettlements) {
        unmatchedSettlementsToInsert.push({
          period_id: periodId,
          seller_gstn: null,
          invoice_no: `SETTLEMENT-ONLY-${settlement.orderId}`,
          invoice_date: null,
          transaction_type: null,
          order_id: settlement.orderId,
          order_date: null,
          item_description: null,
          sku: null,
          quantity: 0,
          tax_exclusive_amount: 0,
          total_tax_amount: 0,
          invoice_amount: 0,
          charges: settlement.charges,
          tcs_igst: settlement.tcsIgst,
          tds: settlement.tds,
          promos: settlement.promos,
          total: round2(settlement.charges + settlement.tcsIgst + settlement.tds + settlement.promos),
          settlement_id: settlement.settlementId,
          deposit_date: settlement.depositDate,
          payment_type: null,
          fulfillment_channel: null,
          type: 'B2C',
        });
      }
    }
  }

  // Unified list of records to insert (including settlement-only placeholders)
  const finalRecordsToInsert = [...recordsWithPeriod, ...unmatchedSettlementsToInsert];

  // Step 7.2 — Delete existing consolidated records
  onProgress('Clearing existing records...', 15, 'Deleting old consolidated records...');
  const { error: deleteRecordsError } = await supabase
    .from('consolidated_records')
    .delete()
    .eq('period_id', periodId);

  if (deleteRecordsError) {
    throw new Error(`Failed to delete existing records: ${deleteRecordsError.message}`);
  }

  // Step 7.3 — Batch insert consolidated records
  const totalRecordBatches = Math.ceil(finalRecordsToInsert.length / BATCH_SIZE);
  onProgress(
    `Uploading ${finalRecordsToInsert.length} records in ${totalRecordBatches} batches...`,
    20,
    `Inserting ${finalRecordsToInsert.length} consolidated records...`
  );

  for (let i = 0; i < totalRecordBatches; i++) {
    const batch = finalRecordsToInsert.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    const { error: insertError } = await supabase
      .from('consolidated_records')
      .insert(batch);

    if (insertError) {
      throw new Error(`Failed to insert records batch ${i + 1}: ${insertError.message}`);
    }

    const percent = 20 + Math.round(((i + 1) / totalRecordBatches) * 40);
    onProgress(
      `Uploaded batch ${i + 1} / ${totalRecordBatches}`,
      percent,
      `Batch ${i + 1}/${totalRecordBatches} uploaded`
    );
  }

  // Phase C: Write updates to database for reconciled rows
  if (updatedRecords.length > 0) {
    onProgress('Updating database matching records...', 85, `Reconciling ${updatedRecords.length} database invoices...`);
    
    const UPDATE_BATCH_SIZE = 100;
    for (let i = 0; i < updatedRecords.length; i += UPDATE_BATCH_SIZE) {
      const batch = updatedRecords.slice(i, i + UPDATE_BATCH_SIZE);
      await Promise.all(
        batch.map((ur) =>
          supabase
            .from('consolidated_records')
            .update({
              charges: ur.charges,
              tcs_igst: ur.tcs_igst,
              tds: ur.tds,
              promos: ur.promos,
              total: ur.total,
              settlement_id: ur.settlement_id,
              deposit_date: ur.deposit_date,
            })
            .eq('id', ur.id)
        )
      );
    }
  }

  // Phase D: Delete matched settlement-only rows from database
  if (deletedSettlementOnlyIds.length > 0) {
    onProgress('Cleaning up temporary records...', 90, `Deleting ${deletedSettlementOnlyIds.length} matched temporary records...`);
    const DELETE_CHUNK_SIZE = 300;
    for (let i = 0; i < deletedSettlementOnlyIds.length; i += DELETE_CHUNK_SIZE) {
      const chunk = deletedSettlementOnlyIds.slice(i, i + DELETE_CHUNK_SIZE);
      await supabase
        .from('consolidated_records')
        .delete()
        .in('id', chunk);
    }
  }

  // Step 7.4 — Delete existing fee records
  onProgress('Clearing existing fee records...', 92, 'Deleting old settlement fees...');
  const { error: deleteFeesError } = await supabase
    .from('settlement_fees')
    .delete()
    .eq('period_id', periodId);

  if (deleteFeesError) {
    throw new Error(`Failed to delete existing fees: ${deleteFeesError.message}`);
  }

  // Step 7.5 — Batch insert fee records
  const totalFeeBatches = Math.ceil(feesWithPeriod.length / BATCH_SIZE);
  onProgress(
    `Uploading ${feesWithPeriod.length} fee records in ${totalFeeBatches} batches...`,
    94,
    `Inserting ${feesWithPeriod.length} settlement fee records...`
  );

  for (let i = 0; i < totalFeeBatches; i++) {
    const batch = feesWithPeriod.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    const { error: insertError } = await supabase
      .from('settlement_fees')
      .insert(batch);

    if (insertError) {
      throw new Error(`Failed to insert fees batch ${i + 1}: ${insertError.message}`);
    }

    const percent = 94 + Math.round(((i + 1) / totalFeeBatches) * 4);
    onProgress(
      `Uploaded fee batch ${i + 1} / ${totalFeeBatches}`,
      percent,
      `Fee batch ${i + 1}/${totalFeeBatches} uploaded`
    );
  }

  // Step 7.6 — Update row count on period
  onProgress('Finalizing...', 98, 'Updating row count on period...');
  const { error: updateError } = await supabase
    .from('periods')
    .update({ row_count: recordsWithPeriod.length }) // Keep count of actual invoice records
    .eq('id', periodId);

  if (updateError) {
    throw new Error(`Failed to update period row count: ${updateError.message}`);
  }

  onProgress('Upload complete!', 100, `✅ Done! ${recordsWithPeriod.length} rows uploaded.`);

  return {
    periodId,
    invoicesReconciled: updatedRecords.length,
    settlementsReconciled: mtrRowsResolved,
    placeholdersCreated: unmatchedSettlementsToInsert.length,
  };
}
