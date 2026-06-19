import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Find April period
  const { data: periods, error: pErr } = await supabase.from('periods').select('*');
  if (pErr) throw pErr;

  const aprilPeriods = periods.filter((p: any) => p.month === 'April');
  console.log('April Periods found:', aprilPeriods);

  if (aprilPeriods.length === 0) {
    console.log('No April periods found.');
    return;
  }

  const periodIds = aprilPeriods.map((p: any) => p.id);

  const { count, error: countErr } = await supabase
    .from('consolidated_records')
    .select('*', { count: 'exact', head: true })
    .in('period_id', periodIds);

  if (countErr) throw countErr;
  
  const totalCount = count || 0;
  console.log(`Total expected records: ${totalCount}`);
  
  const records = [];
  for (let i = 0; i < totalCount; i += 1000) {
    const { data: chunk, error: rErr } = await supabase
      .from('consolidated_records')
      .select('*')
      .in('period_id', periodIds)
      .range(i, i + 999);
      
    if (rErr) throw rErr;
    if (chunk) records.push(...chunk);
  }

  console.log(`Found ${records.length} records for April`);

  let totalTaxableAll = 0;
  let totalAll = 0;

  let totalTaxableShipments = 0;
  let totalShipments = 0;

  let totalTaxableRefunds = 0;
  let totalRefunds = 0;

  const stateTotals: Record<string, { taxable: number; total: number }> = {};

  for (const r of records) {
    totalTaxableAll += (r.tax_exclusive_amount || 0);
    totalAll += (r.invoice_amount || 0);

    if (r.transaction_type === 'Shipment') {
      totalTaxableShipments += (r.tax_exclusive_amount || 0);
      totalShipments += (r.invoice_amount || 0);
    } else {
      totalTaxableRefunds += (r.tax_exclusive_amount || 0);
      totalRefunds += (r.invoice_amount || 0);
    }

    const gstn = r.seller_gstn || 'Unknown';
    if (!stateTotals[gstn]) stateTotals[gstn] = { taxable: 0, total: 0 };
    stateTotals[gstn].taxable += (r.tax_exclusive_amount || 0);
    stateTotals[gstn].total += (r.invoice_amount || 0);
  }

  console.log('--- ALL RECORDS ---');
  console.log('Taxable:', totalTaxableAll.toFixed(2));
  console.log('Total:', totalAll.toFixed(2));

  console.log('--- SHIPMENTS ONLY ---');
  console.log('Taxable:', totalTaxableShipments.toFixed(2));
  console.log('Total:', totalShipments.toFixed(2));

  console.log('--- REFUNDS ONLY ---');
  console.log('Taxable:', totalTaxableRefunds.toFixed(2));
  console.log('Total:', totalRefunds.toFixed(2));

  console.log('--- GSTN-wise ALL RECORDS ---');
  console.log(stateTotals);
}

main().catch(console.error);
