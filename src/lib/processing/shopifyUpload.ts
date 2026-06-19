import { supabase } from '../supabase';
import type { ShopifyParsedRow } from './shopifyParser';

const BATCH_SIZE = 500;

export type ShopifyProgressCallback = (step: string, percent: number, log?: string) => void;

export interface ShopifyUploadResult {
  periodId: string;
  rowCount: number;
}

export async function uploadShopifyToSupabase(
  month: string,
  year: number,
  shopifyRows: ShopifyParsedRow[],
  onProgress: ShopifyProgressCallback
): Promise<ShopifyUploadResult> {
  onProgress('Upserting Shopify period...', 10, `Period: ${month} ${year}`);

  // 1. Upsert period record
  const { data: periodData, error: periodError } = await supabase
    .from('shopify_periods')
    .upsert({ month, year }, { onConflict: 'month,year' })
    .select('id')
    .single();

  if (periodError || !periodData) {
    throw new Error(`Failed to save Shopify period: ${periodError?.message ?? 'No data returned'}`);
  }

  const periodId = periodData.id as string;
  onProgress('Period saved.', 30, `Period ID: ${periodId}`);

  // 2. Clear existing records for this period (for clean overwrite)
  onProgress('Clearing previous records for this period...', 40, 'Deleting old records...');
  const { error: deleteError } = await supabase
    .from('shopify_records')
    .delete()
    .eq('period_id', periodId);

  if (deleteError) {
    throw new Error(`Failed to delete existing Shopify records: ${deleteError.message}`);
  }

  // 3. Batch insert Shopify rows
  const recordsWithPeriod = shopifyRows.map((row) => ({
    ...row,
    period_id: periodId,
  }));

  const totalBatches = Math.ceil(recordsWithPeriod.length / BATCH_SIZE);
  onProgress(`Uploading ${recordsWithPeriod.length} records in ${totalBatches} batches...`, 50, 'Starting batch uploads...');

  for (let i = 0; i < totalBatches; i++) {
    const batch = recordsWithPeriod.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    const { error: insertError } = await supabase
      .from('shopify_records')
      .insert(batch);

    if (insertError) {
      throw new Error(`Failed to insert batch ${i + 1}: ${insertError.message}`);
    }

    const percent = 50 + Math.round(((i + 1) / totalBatches) * 40);
    onProgress(`Uploaded batch ${i + 1} / ${totalBatches}`, percent, `Batch ${i + 1}/${totalBatches} uploaded`);
  }

  // 4. Update row count on period record
  onProgress('Finalizing upload...', 95, 'Updating period row count...');
  const { error: updateError } = await supabase
    .from('shopify_periods')
    .update({ row_count: recordsWithPeriod.length })
    .eq('id', periodId);

  if (updateError) {
    throw new Error(`Failed to update period row count: ${updateError.message}`);
  }

  onProgress('Shopify upload complete!', 100, `Successfully uploaded ${recordsWithPeriod.length} records.`);

  return {
    periodId,
    rowCount: recordsWithPeriod.length,
  };
}
