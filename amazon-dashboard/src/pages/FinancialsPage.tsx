import { useMemo } from 'react';
import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Cell,
  ResponsiveContainer,
} from 'recharts';
import { usePeriodContext } from '../context/PeriodContext';
import { useRecords } from '../hooks/useRecords';
import { useFees } from '../hooks/useFees';
import { KpiCard } from '../components/ui/KpiCard';
import { TreemapChart } from '../components/charts/TreemapChart';
import { DataTable } from '../components/ui/DataTable';
import { PageLoader } from '../components/ui/Loader';
import type { ConsolidatedRecord, SettlementFee } from '../types';
import { formatINR, formatPct, formatDateTime } from '../utils/format';
import {
  Building2,
  Scale,
  Receipt,
  Gift,
  Tag,
  Percent,
  Coins,
} from 'lucide-react';
import './FinancialsPage.css';

const SHIPMENT = 'Shipment';
const REFUND_TYPES = ['Refund', 'FreeReplacement', 'Cancel'];

export function FinancialsPage() {
  const { state } = usePeriodContext();
  const { records, loading: recLoading } = useRecords(state.selectedPeriod?.id ?? null);
  const { fees, loading: feeLoading } = useFees(state.selectedPeriod?.id ?? null);

  const loading = recLoading || feeLoading;

  const waterfall = useMemo(() => computeWaterfall(records), [records]);
  const feeBreakdown = useMemo(() => computeFeeBreakdown(fees), [fees]);
  const taxSummary = useMemo(() => computeTaxSummary(records), [records]);
  const promoKpi = useMemo(() => computePromoKpi(records), [records]);
  const settlements = useMemo(() => computeSettlements(records), [records]);
  const feeAsRevenuePct = useMemo(() => {
    const totalRevenue = records.filter((r) => r.transaction_type === SHIPMENT).reduce((s, r) => s + (r.invoice_amount ?? 0), 0);
    return feeBreakdown.map((f) => ({
      ...f,
      pct: totalRevenue > 0 ? (Math.abs(f.totalAmount) / totalRevenue) * 100 : 0,
    }));
  }, [records, feeBreakdown]);

  if (!state.selectedPeriod) {
    return (
      <div className="empty-state">
        <span className="empty-state-icon">
          <Coins size={48} />
        </span>
        <p className="empty-state-title">No period selected</p>
        <p className="empty-state-description">Select a period to view financial insights</p>
      </div>
    );
  }

  if (loading) return <PageLoader />;

  return (
    <div className="financials-page">
      {/* KPI Row */}
      <div className="kpi-grid">
        <KpiCard
          title="Gross Revenue"
          value={formatINR(waterfall.grossRevenue)}
          rawValue={waterfall.grossRevenue}
          icon={<Coins size={20} />}
        />
        <KpiCard
          title="Net Received"
          value={formatINR(waterfall.netReceived)}
          rawValue={Math.abs(waterfall.netReceived)}
          icon={<Building2 size={20} />}
          color={waterfall.netReceived >= 0 ? 'success' : 'danger'}
        />
        <KpiCard
          title="Total TCS-IGST"
          value={formatINR(waterfall.totalTcs)}
          rawValue={Math.abs(waterfall.totalTcs)}
          icon={<Scale size={20} />}
          color="warning"
        />
        <KpiCard
          title="Total TDS"
          value={formatINR(waterfall.totalTds)}
          rawValue={Math.abs(waterfall.totalTds)}
          icon={<Receipt size={20} />}
          color="warning"
        />
      </div>

      {/* Promo KPI */}
      <div className="kpi-grid kpi-grid--small">
        <KpiCard
          title="Total Promo Discounts"
          value={formatINR(promoKpi.totalPromos)}
          rawValue={Math.abs(promoKpi.totalPromos)}
          icon={<Gift size={20} />}
          color="warning"
        />
        <KpiCard
          title="Promo % of Revenue"
          value={formatPct(promoKpi.promoRevenuePct)}
          rawValue={Math.abs(promoKpi.promoRevenuePct)}
          icon={<Tag size={20} />}
          color="warning"
        />
        <KpiCard
          title="Effective Tax Rate"
          value={formatPct(taxSummary.effectiveTaxRate)}
          rawValue={taxSummary.effectiveTaxRate}
          icon={<Percent size={20} />}
        />
        <KpiCard
          title="Total Tax Collected"
          value={formatINR(taxSummary.totalTaxCollected)}
          rawValue={taxSummary.totalTaxCollected}
          icon={<Scale size={20} />}
        />
      </div>

      {/* Revenue Waterfall */}
      <div className="card">
        <h3 className="section-title">Revenue Waterfall</h3>
        <p className="financials-subtitle">How gross revenue flows to net received after all deductions</p>
        <WaterfallChart data={waterfall.chartData} />
      </div>

      {/* Fee Breakdown Treemap */}
      <div className="card">
        <h3 className="section-title">Fee Breakdown by Type</h3>
        <TreemapChart
          data={feeBreakdown.map((f) => ({ name: f.feeType, value: Math.abs(f.totalAmount) }))}
          formatter={formatINR}
          height={400}
        />
      </div>

      {/* Fee breakdown table with breakeven analysis */}
      <div className="card">
        <h3 className="section-title">📋 Fee Breakdown Table</h3>
        <DataTable
          columns={[
            { key: 'feeType' as keyof (typeof feeAsRevenuePct)[0], header: 'Fee Type', sortable: true },
            {
              key: 'totalAmount' as keyof (typeof feeAsRevenuePct)[0],
              header: 'Total Amount',
              sortable: true,
              align: 'right',
              render: (v) => formatINR(v as number),
            },
            {
              key: 'count' as keyof (typeof feeAsRevenuePct)[0],
              header: 'Occurrences',
              sortable: true,
              align: 'right',
              render: (v) => (v as number).toLocaleString('en-IN'),
            },
            {
              key: 'pct' as keyof (typeof feeAsRevenuePct)[0],
              header: '% of Revenue',
              sortable: true,
              align: 'right',
              render: (v) => formatPct(v as number, 2),
            },
          ]}
          data={feeAsRevenuePct as unknown as Parameters<typeof DataTable>[0]['data']}
          exportable
          exportFilename="fee_breakdown"
          pageSize={20}
        />
      </div>

      {/* Settlements Table */}
      <div className="card">
        <h3 className="section-title">💼 Settlements Data</h3>
        <DataTable
          columns={[
            { key: 'id' as keyof typeof settlements[0], header: 'Settlement Number/ID', sortable: true },
            {
              key: 'date' as keyof typeof settlements[0],
              header: 'Settlement Date',
              sortable: true,
              render: (v) => formatDateTime(v as string),
            },
            {
              key: 'paymentType' as keyof typeof settlements[0],
              header: 'Payment Type',
              sortable: true,
              align: 'center',
            },
            {
              key: 'amount' as keyof typeof settlements[0],
              header: 'Settlement Amount',
              sortable: true,
              align: 'right',
              render: (v) => formatINR(v as number),
            },
          ]}
          data={settlements as unknown as Parameters<typeof DataTable>[0]['data']}
          exportable
          exportFilename="settlements"
          pageSize={10}
        />
      </div>

      {/* Tax Summary */}
      <div className="card">
        <h3 className="section-title">Tax Summary</h3>
        <div className="financials-tax-grid">
          <div className="tax-stat">
            <p className="tax-label">TCS-IGST</p>
            <p className="tax-value">{formatINR(taxSummary.tcsIgst)}</p>
          </div>
          <div className="tax-stat">
            <p className="tax-label">TDS (Section 194-O)</p>
            <p className="tax-value">{formatINR(taxSummary.totalTds)}</p>
          </div>
          <div className="tax-stat">
            <p className="tax-label">Total Tax Collected</p>
            <p className="tax-value">{formatINR(taxSummary.totalTaxCollected)}</p>
          </div>
          <div className="tax-stat">
            <p className="tax-label">Tax Exclusive Amount</p>
            <p className="tax-value">{formatINR(taxSummary.totalTaxExclusive)}</p>
          </div>
          <div className="tax-stat tax-stat--highlight">
            <p className="tax-label">Effective Tax Rate</p>
            <p className="tax-value">{formatPct(taxSummary.effectiveTaxRate, 2)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Waterfall chart implementation ----

interface WaterfallBar {
  name: string;
  value: number;
  type: 'positive' | 'negative' | 'total';
  start: number;
}

function WaterfallChart({ data }: { data: WaterfallBar[] }) {
  const chartData = data.map((d) => ({
    name: d.name,
    invisible: d.type !== 'total' ? d.start : 0,
    value: d.type === 'total' ? d.value : Math.abs(d.value),
    rawValue: d.value,
    type: d.type,
  }));

  const maxVal = Math.max(...data.map((d) => Math.abs(d.start) + Math.abs(d.value)));

  return (
    <ResponsiveContainer width="100%" height={320}>
      <RechartsBarChart data={chartData} margin={{ top: 20, right: 20, left: 20, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
        <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#475569', fontFamily: 'Inter' }} />
        <YAxis
          tick={{ fontSize: 12, fill: '#475569', fontFamily: 'Inter' }}
          tickFormatter={(v: number) => formatINR(v)}
          domain={[0, maxVal * 1.05]}
        />
        <Tooltip
          formatter={(val: any, name: any, props: any) => {
            if (name === 'invisible') return null;
            const rawValue = props?.payload?.rawValue ?? val;
            return [formatINR(rawValue), 'Amount'];
          }}
          contentStyle={{
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
            fontSize: 13,
          }}
        />
        <ReferenceLine y={0} stroke="#E2E8F0" />
        <Bar dataKey="invisible" stackId="a" fill="transparent" />
        <Bar dataKey="value" stackId="a" radius={[4, 4, 0, 0]}>
          {chartData.map((entry, index) => (
            <Cell
              key={index}
              fill={
                entry.type === 'total'
                  ? '#1F3864'
                  : entry.type === 'positive'
                  ? '#10B981'
                  : '#EF4444'
              }
            />
          ))}
        </Bar>
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}

// ---- Computation helpers ----

interface WaterfallData {
  grossRevenue: number;
  totalRefunds: number;
  totalCharges: number;
  totalTcs: number;
  totalTds: number;
  totalPromos: number;
  netReceived: number;
  chartData: WaterfallBar[];
}

function computeWaterfall(records: ConsolidatedRecord[]): WaterfallData {
  const shipments = records.filter((r) => r.transaction_type === SHIPMENT);
  const grossRevenue = shipments.reduce((s, r) => s + (r.invoice_amount ?? 0), 0);
  const totalRefunds = records.filter((r) => r.transaction_type && REFUND_TYPES.includes(r.transaction_type)).reduce((s, r) => s + (r.invoice_amount ?? 0), 0);
  const totalCharges = records.reduce((s, r) => s + (r.charges ?? 0), 0);
  const totalTcs = records.reduce((s, r) => s + (r.tcs_igst ?? 0), 0);
  const totalTds = records.reduce((s, r) => s + (r.tds ?? 0), 0);
  const totalPromos = records.reduce((s, r) => s + (r.promos ?? 0), 0);
  const netReceived = records.reduce((s, r) => s + (r.total ?? 0), 0);

  // Build waterfall from top
  let runningTotal = grossRevenue;
  const chartData: WaterfallBar[] = [
    { name: 'Gross Revenue', value: grossRevenue, type: 'positive', start: 0 },
  ];

  if (totalRefunds !== 0) {
    chartData.push({ name: 'Refunds', value: totalRefunds, type: 'negative', start: runningTotal + Math.min(totalRefunds, 0) });
    runningTotal += totalRefunds;
  }
  if (totalCharges !== 0) {
    chartData.push({ name: 'Charges', value: totalCharges, type: 'negative', start: runningTotal + Math.min(totalCharges, 0) });
    runningTotal += totalCharges;
  }
  if (totalTcs !== 0) {
    chartData.push({ name: 'TCS-IGST', value: totalTcs, type: 'negative', start: runningTotal + Math.min(totalTcs, 0) });
    runningTotal += totalTcs;
  }
  if (totalTds !== 0) {
    chartData.push({ name: 'TDS', value: totalTds, type: 'negative', start: runningTotal + Math.min(totalTds, 0) });
    runningTotal += totalTds;
  }
  if (totalPromos !== 0) {
    chartData.push({ name: 'Promos', value: totalPromos, type: 'negative', start: runningTotal + Math.min(totalPromos, 0) });
    runningTotal += totalPromos;
  }
  chartData.push({ name: 'Net Received', value: netReceived, type: 'total', start: 0 });

  return { grossRevenue, totalRefunds, totalCharges, totalTcs, totalTds, totalPromos, netReceived, chartData };
}

interface FeeRow {
  feeType: string;
  totalAmount: number;
  count: number;
}

function computeFeeBreakdown(fees: SettlementFee[]): FeeRow[] {
  const byType = new Map<string, { total: number; count: number }>();

  for (const fee of fees) {
    const existing = byType.get(fee.fee_type) ?? { total: 0, count: 0 };
    byType.set(fee.fee_type, {
      total: existing.total + (fee.fee_amount ?? 0),
      count: existing.count + 1,
    });
  }

  return [...byType.entries()]
    .map(([feeType, { total, count }]) => ({ feeType, totalAmount: total, count }))
    .sort((a, b) => a.totalAmount - b.totalAmount);
}

function computeTaxSummary(records: ConsolidatedRecord[]) {
  const tcsIgst = records.reduce((s, r) => s + (r.tcs_igst ?? 0), 0);
  const totalTds = records.reduce((s, r) => s + (r.tds ?? 0), 0);
  const totalTaxCollected = records.reduce((s, r) => s + (r.total_tax_amount ?? 0), 0);
  const totalTaxExclusive = records.reduce((s, r) => s + (r.tax_exclusive_amount ?? 0), 0);
  const effectiveTaxRate = totalTaxExclusive > 0 ? (totalTaxCollected / totalTaxExclusive) * 100 : 0;

  return { tcsIgst, totalTds, totalTaxCollected, totalTaxExclusive, effectiveTaxRate };
}

function computePromoKpi(records: ConsolidatedRecord[]) {
  const totalPromos = records.reduce((s, r) => s + (r.promos ?? 0), 0);
  const totalRevenue = records.filter((r) => r.transaction_type === SHIPMENT).reduce((s, r) => s + (r.invoice_amount ?? 0), 0);
  const promoRevenuePct = totalRevenue > 0 ? (Math.abs(totalPromos) / totalRevenue) * 100 : 0;
  return { totalPromos, promoRevenuePct };
}

function computeSettlements(records: ConsolidatedRecord[]) {
  const bySettlement: Record<
    string,
    { id: string; date: string; amount: number; paymentTypes: Set<string> }
  > = {};

  for (const r of records) {
    const sid = r.settlement_id ?? 'Unknown';
    if (!bySettlement[sid]) {
      bySettlement[sid] = {
        id: sid,
        date: r.deposit_date ?? 'N/A',
        amount: 0,
        paymentTypes: new Set<string>(),
      };
    }
    bySettlement[sid].amount += r.total ?? 0;
    if (r.payment_type) {
      bySettlement[sid].paymentTypes.add(r.payment_type);
    }
  }

  return Object.values(bySettlement)
    .map((s) => {
      const types = Array.from(s.paymentTypes).filter(Boolean);
      const paymentTypeStr = types.length > 0 ? types.join(' & ') : 'N/A';
      return {
        id: s.id,
        date: s.date,
        amount: s.amount,
        paymentType: paymentTypeStr,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}
