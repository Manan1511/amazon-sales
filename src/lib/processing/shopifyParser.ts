import Papa from 'papaparse';
import * as XLSX from 'xlsx';

export interface ShopifyParsedRow {
  date: string | null;
  invoice_no: string | null;
  order_id: string | null;
  sku: string | null;
  qty: number;
  total: number;
  sales: number;
  cgst: number;
  sgst: number;
  igst: number;
  other_charges: number;
  other_charges1: number;
  entity: string | null;
  billing_party_code: string | null;
  payment_method: string | null;
  taxable_amount: number;
  total_gst: number;
}

function parseNumber(val: unknown): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  const cleaned = String(val).replace(/,/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

function cleanDate(dateVal: unknown): string | null {
  if (!dateVal) return null;
  const str = String(dateVal).trim();
  // If DD-MM-YYYY format
  if (/^\d{1,2}-\d{1,2}-\d{4}/.test(str)) {
    const parts = str.split(' ')[0].split('-');
    const day = parts[0].padStart(2, '0');
    const month = parts[1].padStart(2, '0');
    const year = parts[2];
    return `${year}-${month}-${day}`;
  }
  // If YYYY-MM-DD
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(str)) {
    const parts = str.split(' ')[0].split('-');
    const year = parts[0];
    const month = parts[1].padStart(2, '0');
    const day = parts[2].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return str;
}

// Case-insensitive header matching
function getHeaderValue(row: Record<string, unknown>, possibleHeaders: string[]): unknown {
  const keys = Object.keys(row);
  for (const header of possibleHeaders) {
    const foundKey = keys.find(k => k.toLowerCase().replace(/[\s_-]/g, '') === header.toLowerCase().replace(/[\s_-]/g, ''));
    if (foundKey) return row[foundKey];
  }
  return undefined;
}

export function parseShopifyData(rawRows: Record<string, unknown>[]): ShopifyParsedRow[] {
  const result: ShopifyParsedRow[] = [];

  for (const row of rawRows) {
    // 1. Resolve values using flexible header names
    const entity = String(getHeaderValue(row, ['Entity']) ?? '').trim();

    // EXCLUSION RULE: If entity has CAN_INVOICE, ignore completely
    if (entity.toUpperCase().includes('CAN_INVOICE')) {
      continue;
    }

    const rawDate = getHeaderValue(row, ['Date']);
    const date = cleanDate(rawDate);
    const invoiceNo = String(getHeaderValue(row, ['Invoice number', 'InvoiceNo', 'Invoice_No', 'Invoice ID']) ?? '').trim() || null;
    const orderId = String(getHeaderValue(row, ['Sale Order Number', 'OrderID', 'Order_ID', 'Order Number']) ?? '').trim() || null;
    const sku = String(getHeaderValue(row, ['Product SKU Code', 'Product SKU', 'SKU']) ?? '').trim() || null;
    const qty = Math.round(parseNumber(getHeaderValue(row, ['Qty', 'Quantity'])));
    const total = parseNumber(getHeaderValue(row, ['Total']));
    const sales = parseNumber(getHeaderValue(row, ['Sales']));
    const cgst = parseNumber(getHeaderValue(row, ['CGST']));
    const sgst = parseNumber(getHeaderValue(row, ['SGST']));
    const igst = parseNumber(getHeaderValue(row, ['IGST']));
    const otherCharges = parseNumber(getHeaderValue(row, ['Other charges', 'OtherCharge']));
    const otherCharges1 = parseNumber(getHeaderValue(row, ['Other charges1', 'OtherCharge1']));
    const billingPartyCode = String(getHeaderValue(row, ['Billing Party Code', 'BillingPartyCode']) ?? '').trim() || null;
    const paymentMethod = String(getHeaderValue(row, ['Payment Method', 'PaymentMethod']) ?? '').trim() || null;

    // CALCULATIONS:
    // Taxable Amount = Sales + Other charges + Other charges1
    const taxable_amount = Math.round((sales + otherCharges + otherCharges1 + Number.EPSILON) * 100) / 100;
    // Total GST = CGST + SGST + IGST
    const total_gst = Math.round((cgst + sgst + igst + Number.EPSILON) * 100) / 100;

    result.push({
      date,
      invoice_no: invoiceNo,
      order_id: orderId,
      sku,
      qty,
      total,
      sales,
      cgst,
      sgst,
      igst,
      other_charges: otherCharges,
      other_charges1: otherCharges1,
      entity: entity || null,
      billing_party_code: billingPartyCode,
      payment_method: paymentMethod,
      taxable_amount,
      total_gst
    });
  }

  return result;
}

export function parseShopifyFile(file: File): Promise<ShopifyParsedRow[]> {
  return new Promise((resolve, reject) => {
    const extension = file.name.split('.').pop()?.toLowerCase();

    if (extension === 'csv') {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          try {
            const parsed = parseShopifyData(results.data as Record<string, unknown>[]);
            resolve(parsed);
          } catch (err) {
            reject(err);
          }
        },
        error: (err) => reject(err)
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
          const parsed = parseShopifyData(json);
          resolve(parsed);
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
