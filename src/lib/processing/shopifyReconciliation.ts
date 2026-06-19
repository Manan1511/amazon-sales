import Papa from 'papaparse';
import * as XLSX from 'xlsx';

export interface RecoResultRow {
  'Sales order number': string;
  'invoice number': string;
  'invoice date': string;
  'total sales': number;
  'awb number': string;
  'COD value': number;
  'Status': string;
  'Difference': number;
}

// Case-insensitive header matching
function getHeaderValue(row: Record<string, unknown>, possibleHeaders: string[]): unknown {
  const keys = Object.keys(row);
  for (const header of possibleHeaders) {
    const foundKey = keys.find(
      (k) => k.toLowerCase().replace(/[\s_.-]/g, '') === header.toLowerCase().replace(/[\s_.-]/g, '')
    );
    if (foundKey) return row[foundKey];
  }
  return undefined;
}

function parseNumber(val: unknown): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  const cleaned = String(val).replace(/,/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

function cleanAwb(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number') {
    return BigInt(Math.round(val)).toString();
  }
  const str = String(val).trim();
  if (/e/i.test(str) && !isNaN(Number(str))) {
    try {
      return BigInt(Math.round(Number(str))).toString();
    } catch {
      return str;
    }
  }
  return str.replace(/\.0$/, '');
}

function parseFileRows(file: File): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const extension = file.name.split('.').pop()?.toLowerCase();

    if (extension === 'csv') {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          resolve(results.data as Record<string, unknown>[]);
        },
        error: (err) => reject(err),
      });
    } else if (extension === 'xls' || extension === 'xlsx') {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const json = XLSX.utils.sheet_to_json(worksheet) as Record<string, unknown>[];
          resolve(json);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = (err) => reject(err);
      reader.readAsArrayBuffer(file);
    } else {
      reject(new Error('Unsupported file format. Please upload a .csv, .xls, or .xlsx file.'));
    }
  });
}

/**
 * Runs the COD reconciliation logic on Tally GST rows and AWB wise billing statement rows.
 */
export async function runCodReconciliation(
  tallyFile: File,
  awbFile: File
): Promise<{
  rows: RecoResultRow[];
  summary: {
    totalCodOrders: number;
    matched: number;
    valueMismatch: number;
    notRemitted: number;
    missingAwb: number;
  };
}> {
  const tallyRaw = await parseFileRows(tallyFile);
  const awbRaw = await parseFileRows(awbFile);

  // 1. Process AWB statement into a map: AWB -> Price
  const awbRemittanceMap = new Map<string, number>();
  for (const row of awbRaw) {
    const rawAwb = getHeaderValue(row, ['AWB NO.', 'AWB NO', 'AWB Number', 'AWB']);
    if (rawAwb === undefined) continue;

    const awbStr = cleanAwb(rawAwb);
    if (!awbStr) continue;

    const price = parseNumber(getHeaderValue(row, ['Price', 'COD Value', 'COD Amount', 'Amount', 'Remitted Amount']));
    // Cumulative if AWB appears multiple times
    awbRemittanceMap.set(awbStr, (awbRemittanceMap.get(awbStr) ?? 0) + price);
  }

  // 2. Process Tally GST Report and match
  const results: RecoResultRow[] = [];
  const summary = {
    totalCodOrders: 0,
    matched: 0,
    valueMismatch: 0,
    notRemitted: 0,
    missingAwb: 0,
  };

  // Keep track of order details to avoid double-processing items or to aggregate item lines.
  // In Tally GST Report, multiple lines might represent the same order/invoice and same AWB,
  // but they have different SKUs. We should group/aggregate them by AWB so we reconcile total order totals!
  const tallyGrouped = new Map<
    string,
    {
      orderNo: string;
      invoiceNo: string;
      date: string;
      totalSales: number;
      awbNo: string;
    }
  >();

  for (const row of tallyRaw) {
    // Check if it's a COD order
    const pm = String(getHeaderValue(row, ['Payment Method', 'PaymentMethod', 'Payment_Method']) ?? '').trim().toUpperCase();
    if (!pm.includes('COD') && !pm.includes('DELIVERY')) {
      continue; // Ignore prepaid/online orders
    }

    const orderNo = String(getHeaderValue(row, ['Sale Order Number', 'OrderID', 'Order_ID', 'Order Number']) ?? '').trim();
    const invoiceNo = String(getHeaderValue(row, ['Invoice number', 'InvoiceNo', 'Invoice_No', 'Invoice ID']) ?? '').trim();
    const date = String(getHeaderValue(row, ['Date', 'Invoice Date', 'Date_Created']) ?? '').trim();
    const total = parseNumber(getHeaderValue(row, ['Total']));
    const rawAwb = getHeaderValue(row, ['AWB num', 'AWB NO', 'AWB Number', 'AWB']);
    const awbNo = cleanAwb(rawAwb);

    // If an AWB is present, group by AWB. If AWB is missing, group by Order Number or Invoice Number.
    const groupKey = awbNo || `NO_AWB_${orderNo || invoiceNo}_${Math.random()}`;

    const existing = tallyGrouped.get(groupKey);
    if (existing) {
      existing.totalSales += total;
    } else {
      tallyGrouped.set(groupKey, {
        orderNo,
        invoiceNo,
        date,
        totalSales: total,
        awbNo,
      });
    }
  }

  // Reconcile the grouped Tally COD orders
  for (const tallyOrder of tallyGrouped.values()) {
    summary.totalCodOrders++;

    const awb = tallyOrder.awbNo;
    const totalSales = Math.round((tallyOrder.totalSales + Number.EPSILON) * 100) / 100;

    if (!awb) {
      summary.missingAwb++;
      results.push({
        'Sales order number': tallyOrder.orderNo,
        'invoice number': tallyOrder.invoiceNo,
        'invoice date': tallyOrder.date,
        'total sales': totalSales,
        'awb number': 'MISSING',
        'COD value': 0,
        'Status': 'Missing AWB in Tally',
        'Difference': totalSales,
      });
      continue;
    }

    // Lookup AWB in remittance statement
    const remittedValue = awbRemittanceMap.get(awb);

    if (remittedValue === undefined) {
      summary.notRemitted++;
      results.push({
        'Sales order number': tallyOrder.orderNo,
        'invoice number': tallyOrder.invoiceNo,
        'invoice date': tallyOrder.date,
        'total sales': totalSales,
        'awb number': awb,
        'COD value': 0,
        'Status': 'Not Remitted',
        'Difference': totalSales,
      });
    } else {
      const codValue = Math.round((remittedValue + Number.EPSILON) * 100) / 100;
      const difference = Math.round((totalSales - codValue + Number.EPSILON) * 100) / 100;

      if (Math.abs(difference) <= 1) { // Allow tiny rounding difference of 1 INR
        summary.matched++;
        results.push({
          'Sales order number': tallyOrder.orderNo,
          'invoice number': tallyOrder.invoiceNo,
          'invoice date': tallyOrder.date,
          'total sales': totalSales,
          'awb number': awb,
          'COD value': codValue,
          'Status': 'Matched',
          'Difference': 0,
        });
      } else {
        summary.valueMismatch++;
        results.push({
          'Sales order number': tallyOrder.orderNo,
          'invoice number': tallyOrder.invoiceNo,
          'invoice date': tallyOrder.date,
          'total sales': totalSales,
          'awb number': awb,
          'COD value': codValue,
          'Status': 'Value Mismatch',
          'Difference': difference,
        });
      }
    }
  }

  return { rows: results, summary };
}
