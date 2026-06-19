import { useMemo } from 'react';
import { differenceInDays, parseISO, isValid } from 'date-fns';
import { usePeriodContext } from '../context/PeriodContext';
import { usePlatform } from '../context/PlatformContext';
import { useRecords } from '../hooks/useRecords';
import { KpiCard } from '../components/ui/KpiCard';
import { DonutChart } from '../components/charts/DonutChart';
import { BarChart } from '../components/charts/BarChart';
import { LineChart } from '../components/charts/LineChart';
import { PageLoader } from '../components/ui/Loader';
import { formatINR, formatDateTime } from '../utils/format';
import { getPreviousPeriod, getCompareDetails } from '../utils/compare';
import {
  IndianRupee,
  ShoppingCart,
  Package,
  TrendingUp,
  Building2,
  Receipt,
  Undo2,
  Percent,
  Calendar,
  CreditCard,
  Truck,
  BarChart3,
  Landmark,
  Tag,
} from 'lucide-react';
import './DashboardPage.css';

const SHIPMENT = 'Shipment';
const REFUND_TYPES = ['Refund', 'FreeReplacement', 'Cancel'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function DashboardPage() {
  const { state } = usePeriodContext();
  const { platform } = usePlatform();
  const { records, loading } = useRecords(state.selectedPeriod?.id ?? null);

  // Load previous period records for period-over-period comparison
  const previousPeriod = useMemo(() => {
    return getPreviousPeriod(state.selectedPeriod, state.periods);
  }, [state.selectedPeriod, state.periods]);

  const { records: prevRecords } = useRecords(previousPeriod?.id ?? null);

  const prevPeriodCount = previousPeriod ? 1 : 0;
  const hasCompare = prevPeriodCount > 0 && prevRecords.length > 0;

  // --- SHOPIFY SPECIFIC COMPUTATIONS ---
  const shopifyData = useMemo(() => {
    if (platform !== 'shopify') return null;
    return computeShopifyInsights(records);
  }, [records, platform]);

  const prevShopifyData = useMemo(() => {
    if (platform !== 'shopify') return null;
    return computeShopifyInsights(prevRecords);
  }, [prevRecords, platform]);

  // --- AMAZON SPECIFIC COMPUTATIONS ---
  const kpis = useMemo(() => computeKpis(records, platform), [records, platform]);
  const prevKpis = useMemo(() => computeKpis(prevRecords, platform), [prevRecords, platform]);

  const paymentData = useMemo(() => computePaymentData(records, platform), [records, platform]);
  const fulfillmentData = useMemo(() => computeFulfillmentData(records, platform), [records, platform]);
  const transactionData = useMemo(() => computeTransactionData(records, platform), [records, platform]);
  const gstnData = useMemo(() => computeGstnData(records, platform), [records, platform]);
  const settlementTrend = useMemo(() => computeSettlementTrend(records, platform), [records, platform]);
  const dayOfWeekData = useMemo(() => computeDayOfWeekData(records, platform), [records, platform]);
  
  const extraKpis = useMemo(() => computeExtraKpis(records, platform), [records, platform]);
  const prevExtraKpis = useMemo(() => computeExtraKpis(prevRecords, platform), [prevRecords, platform]);

  const typeData = useMemo(() => computeTypeData(records, platform), [records, platform]);

  if (!state.selectedPeriod) {
    return (
      <div className="empty-state">
        <span className="empty-state-icon">
          <Package size={48} />
        </span>
        <p className="empty-state-title">No period selected</p>
        <p className="empty-state-description">
          Select or upload a period to get started
        </p>
      </div>
    );
  }

  if (loading) {
    return <PageLoader />;
  }

  // --- RENDER SHOPIFY DASHBOARD ---
  if (platform === 'shopify' && shopifyData) {
    const s = shopifyData;
    const ps = prevShopifyData;

    return (
      <div className="dashboard-page shopify-dashboard">
        {/* KPI Grid */}
        <section aria-label="Shopify Key Performance Indicators">
          <div className="kpi-grid">
            <KpiCard
              title="Gross Sales"
              value={formatINR(s.grossSales)}
              rawValue={s.grossSales}
              icon={<IndianRupee size={20} />}
              color="default"
              {...(hasCompare && ps ? getCompareDetails(s.grossSales, ps.grossSales) : {})}
            />
            <KpiCard
              title="Taxable Amount"
              value={formatINR(s.taxableAmount)}
              rawValue={s.taxableAmount}
              icon={<IndianRupee size={20} />}
              color="default"
              {...(hasCompare && ps ? getCompareDetails(s.taxableAmount, ps.taxableAmount) : {})}
            />
            <KpiCard
              title="GST Collected"
              value={formatINR(s.gstCollected)}
              rawValue={s.gstCollected}
              icon={<Landmark size={20} />}
              color="success"
              {...(hasCompare && ps ? getCompareDetails(s.gstCollected, ps.gstCollected) : {})}
            />
            <KpiCard
              title="Total Billing (INR)"
              value={formatINR(s.totalSales)}
              rawValue={s.totalSales}
              icon={<IndianRupee size={20} />}
              color="default"
              {...(hasCompare && ps ? getCompareDetails(s.totalSales, ps.totalSales) : {})}
            />
            <KpiCard
              title="Total Orders"
              value={s.orderCount.toLocaleString('en-IN')}
              rawValue={s.orderCount}
              icon={<ShoppingCart size={20} />}
              {...(hasCompare && ps ? getCompareDetails(s.orderCount, ps.orderCount) : {})}
            />
            <KpiCard
              title="Units Shipped"
              value={s.unitsSold.toLocaleString('en-IN')}
              rawValue={s.unitsSold}
              icon={<Package size={20} />}
              {...(hasCompare && ps ? getCompareDetails(s.unitsSold, ps.unitsSold) : {})}
            />
            <KpiCard
              title="Average Order Value"
              value={formatINR(s.aov)}
              rawValue={s.aov}
              icon={<TrendingUp size={20} />}
              {...(hasCompare && ps ? getCompareDetails(s.aov, ps.aov) : {})}
            />
            <KpiCard
              title="Shipping & COD Fees"
              value={formatINR(s.shippingCharges)}
              rawValue={s.shippingCharges}
              icon={<Receipt size={20} />}
              color="warning"
              {...(hasCompare && ps ? getCompareDetails(s.shippingCharges, ps.shippingCharges) : {})}
            />
          </div>
        </section>

        {/* GST Type & Payment Method row */}
        <section aria-label="Tax & Payment Insights" className="dashboard-row">
          {/* GST Collect Split */}
          <div className="card split-card">
            <div>
              <h3 className="section-title"><Landmark size={18} className="inline-icon" /> Intrastate vs Interstate (GST)</h3>
              <div className="split-list">
                {s.gstBreakdown.map((g) => (
                  <div key={g.name} className="split-row">
                    <span className="split-label">{g.name}</span>
                    <div className="split-details">
                      <div className="split-revenue">{formatINR(g.value)}</div>
                      <div className="split-count">{((g.value / (s.gstCollected || 1)) * 100).toFixed(1)}% of GST</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="split-chart-wrapper">
              <DonutChart data={s.gstBreakdown} formatter={formatINR} height={180} innerRadius={35} outerRadius={55} showLabels={false} />
            </div>
          </div>

          {/* Payment Method Share */}
          <div className="card split-card">
            <div>
              <h3 className="section-title"><CreditCard size={18} className="inline-icon" /> Shopify Payment Share</h3>
              <div className="split-list">
                {s.paymentMethods.map((p) => (
                  <div key={p.name} className="split-row">
                    <span className="split-label">{p.name} Orders</span>
                    <div className="split-details">
                      <div className="split-revenue">{p.value.toLocaleString('en-IN')} orders</div>
                      <div className="split-count">{p.pct.toFixed(1)}%</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="split-chart-wrapper">
              <DonutChart data={s.paymentMethods} formatter={(v) => v.toLocaleString('en-IN') + ' orders'} height={180} innerRadius={35} outerRadius={55} showLabels={false} />
            </div>
          </div>
        </section>

        {/* Top Products & Sales Trend */}
        <section aria-label="Popular Products & Sales Trend" className="dashboard-row">
          {/* Top Selling Products */}
          <div className="card" style={{ flex: 1.2 }}>
            <h3 className="section-title"><Package size={18} className="inline-icon" /> Top 5 Selling SKUs (by Revenue)</h3>
            <BarChart
              data={s.topSkus}
              dataKey="value"
              formatter={formatINR}
              height={260}
              colorEachBar
            />
          </div>

          {/* Daily Trend */}
          <div className="card" style={{ flex: 1.8 }}>
            <h3 className="section-title"><TrendingUp size={18} className="inline-icon" /> Daily Sales Trend</h3>
            <LineChart
              data={s.dailyTrend}
              dataKey="value"
              formatter={formatINR}
              height={260}
            />
          </div>
        </section>

        {/* Regional / Wholesaler billing list */}
        <section aria-label="Billing Party Performance">
          <div className="card">
            <h3 className="section-title"><Building2 size={18} className="inline-icon" /> Top Billing Parties / Customer Codes</h3>
            <div className="gstn-table-scroll">
              <table className="gstn-table" aria-label="Billing Party rankings">
                <thead>
                  <tr>
                    <th>Billing Party Code</th>
                    <th className="text-right">Taxable Sales</th>
                    <th className="text-right">GST Collected</th>
                    <th className="text-right">Total Billing</th>
                  </tr>
                </thead>
                <tbody>
                  {s.billingParties.map((party) => (
                    <tr key={party.gstn}>
                      <td><strong>{party.gstn}</strong></td>
                      <td className="text-right">{formatINR(party.taxable)}</td>
                      <td className="text-right">{formatINR(party.gst)}</td>
                      <td className="text-right">{formatINR(party.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* SKU Performance & Unit Economics */}
        <section aria-label="SKU Unit Economics" style={{ marginTop: 'var(--space-2)' }}>
          <div className="card">
            <h3 className="section-title"><Tag size={18} className="inline-icon" /> SKU Performance & Unit Economics</h3>
            <div className="gstn-table-scroll" style={{ maxHeight: '420px', overflowY: 'auto' }}>
              <table className="gstn-table" aria-label="SKU Unit Economics Table">
                <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                  <tr>
                    <th>Product SKU</th>
                    <th className="text-right">Units Sold</th>
                    <th className="text-right">Taxable Sales</th>
                    <th className="text-right">Avg Selling Price (ASP)</th>
                    <th className="text-right">Shipping & COD charges</th>
                    <th className="text-right">Charges % of Sales</th>
                    <th className="text-right">Total Billing</th>
                  </tr>
                </thead>
                <tbody>
                  {s.skuEconomics.map((sku) => (
                    <tr key={sku.sku}>
                      <td><strong>{sku.sku}</strong></td>
                      <td className="text-right">{sku.qty.toLocaleString('en-IN')}</td>
                      <td className="text-right">{formatINR(sku.taxableSales)}</td>
                      <td className="text-right">{formatINR(sku.asp)}</td>
                      <td className="text-right">{formatINR(sku.otherCharges)}</td>
                      <td className="text-right">
                        <span className={`badge ${sku.chargesPct > 15 ? 'badge--warning' : 'badge--success'}`} style={{
                          padding: '2px 8px',
                          borderRadius: 'var(--radius-full)',
                          fontSize: 'var(--text-xs)',
                          fontWeight: 600,
                          backgroundColor: sku.chargesPct > 15 ? 'var(--color-warning-xlight)' : 'var(--color-success-xlight)',
                          color: sku.chargesPct > 15 ? 'var(--color-warning-dark)' : 'var(--color-success-dark)',
                          border: `1px solid ${sku.chargesPct > 15 ? 'var(--color-warning-light)' : 'var(--color-success-light)'}`
                        }}>
                          {sku.chargesPct.toFixed(1)}%
                        </span>
                      </td>
                      <td className="text-right">{formatINR(sku.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    );
  }

  // --- RENDER AMAZON DASHBOARD ---
  return (
    <div className="dashboard-page">
      {/* KPI Row */}
      <section aria-label="Key Performance Indicators">
        <div className="kpi-grid">
          <KpiCard
            title="Total Revenue"
            value={formatINR(kpis.totalRevenue)}
            rawValue={kpis.totalRevenue}
            icon={<IndianRupee size={20} />}
            color="default"
            {...(hasCompare ? getCompareDetails(kpis.totalRevenue, prevKpis.totalRevenue) : {})}
          />
          <KpiCard
            title="Tax Exclusive"
            value={formatINR(kpis.totalTaxable)}
            rawValue={kpis.totalTaxable}
            icon={<IndianRupee size={20} />}
            color="default"
            {...(hasCompare ? getCompareDetails(kpis.totalTaxable, prevKpis.totalTaxable) : {})}
          />
          <KpiCard
            title="Total Orders"
            value={kpis.totalOrders.toLocaleString('en-IN')}
            rawValue={kpis.totalOrders}
            icon={<ShoppingCart size={20} />}
            {...(hasCompare ? getCompareDetails(kpis.totalOrders, prevKpis.totalOrders) : {})}
          />
          <KpiCard
            title="Units Sold"
            value={kpis.unitsSold.toLocaleString('en-IN')}
            rawValue={kpis.unitsSold}
            icon={<Package size={20} />}
            {...(hasCompare ? getCompareDetails(kpis.unitsSold, prevKpis.unitsSold) : {})}
          />
          <KpiCard
            title="Avg Order Value"
            value={formatINR(kpis.avgOrderValue)}
            rawValue={kpis.avgOrderValue}
            icon={<TrendingUp size={20} />}
            {...(hasCompare ? getCompareDetails(kpis.avgOrderValue, prevKpis.avgOrderValue) : {})}
          />
          <KpiCard
            title="Net Received"
            value={formatINR(kpis.netReceived)}
            rawValue={Math.abs(kpis.netReceived)}
            icon={<Building2 size={20} />}
            color={kpis.netReceived >= 0 ? 'success' : 'danger'}
            {...(hasCompare ? getCompareDetails(kpis.netReceived, prevKpis.netReceived) : {})}
          />
          <KpiCard
            title="Total Charges"
            value={formatINR(kpis.totalCharges)}
            rawValue={Math.abs(kpis.totalCharges)}
            icon={<Receipt size={20} />}
            color="danger"
            {...(hasCompare ? getCompareDetails(kpis.totalCharges, prevKpis.totalCharges) : {})}
          />
          <KpiCard
            title="Total Refunds"
            value={formatINR(kpis.totalRefunds)}
            rawValue={Math.abs(kpis.totalRefunds)}
            icon={<Undo2 size={20} />}
            color="warning"
            {...(hasCompare ? getCompareDetails(kpis.totalRefunds, prevKpis.totalRefunds) : {})}
          />
          <KpiCard
            title="Refund Rate"
            value={`${kpis.refundRate.toFixed(1)}%`}
            rawValue={kpis.refundRate}
            icon={<Percent size={20} />}
            color={kpis.refundRate > 15 ? 'danger' : kpis.refundRate > 5 ? 'warning' : 'success'}
            {...(hasCompare ? getCompareDetails(kpis.refundRate, prevKpis.refundRate, true) : {})}
          />
        </div>
      </section>

      {/* Extra KPIs */}
      <section aria-label="Additional Insights">
        <div className="kpi-grid kpi-grid--small">
          <KpiCard
            title="Avg Selling Price / Unit"
            value={formatINR(extraKpis.avgPricePerUnit)}
            rawValue={extraKpis.avgPricePerUnit}
            icon={<IndianRupee size={16} />}
            {...(hasCompare ? getCompareDetails(extraKpis.avgPricePerUnit, prevExtraKpis.avgPricePerUnit) : {})}
          />
          <KpiCard
            title="Gross Margin Proxy"
            value={`${extraKpis.grossMargin.toFixed(1)}%`}
            rawValue={extraKpis.grossMargin}
            icon={<TrendingUp size={16} />}
            color={extraKpis.grossMargin > 70 ? 'success' : extraKpis.grossMargin > 40 ? 'warning' : 'danger'}
            {...(hasCompare ? getCompareDetails(extraKpis.grossMargin, prevExtraKpis.grossMargin, true) : {})}
          />
          <KpiCard
            title="Top Revenue Day"
            value={extraKpis.topRevenueDay ? (() => {
              const formatted = formatDateTime(extraKpis.topRevenueDay);
              return formatted.includes(' ') ? formatted.split(' ')[0] : formatted;
            })() : 'N/A'}
            icon={<Calendar size={16} />}
            subtitle={hasCompare && prevExtraKpis.topRevenueDay ? `vs last period: ${(() => {
              const formatted = formatDateTime(prevExtraKpis.topRevenueDay);
              return formatted.includes(' ') ? formatted.split(' ')[0] : formatted;
            })()}` : 'vs last period: N/A'}
            trend="neutral"
          />
        </div>
      </section>

      {/* Row 2 — Payment Method Split */}
      <section aria-label="Payment Method Split">
        <div className="card">
          <h3 className="section-title"><CreditCard size={18} className="inline-icon" /> Payment Method Split</h3>
          <div className="dashboard-payment-split">
            <div className="dashboard-donut-wrapper">
              <DonutChart
                data={paymentData.chartData}
                formatter={(v) => v.toLocaleString('en-IN') + ' orders'}
                height={280}
              />
            </div>
            <div className="dashboard-payment-stats">
              {paymentData.stats.map((stat) => (
                <div key={stat.label} className="payment-stat-box">
                  <p className="payment-stat-label">{stat.label}</p>
                  <p className="payment-stat-value">{stat.count.toLocaleString('en-IN')}</p>
                  <p className="payment-stat-pct">{stat.pct.toFixed(1)}%</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Row 2.5 — B2B vs B2C Customer Split */}
      <section aria-label="B2B vs B2C Sales Split">
        <div className="card">
          <h3 className="section-title"><Building2 size={18} className="inline-icon" /> B2B vs B2C Sales Split</h3>
          <div className="dashboard-payment-split">
            <div className="dashboard-donut-wrapper">
              <DonutChart
                data={typeData.chartData}
                formatter={formatINR}
                height={280}
              />
            </div>
            <div className="dashboard-payment-stats">
              {typeData.stats.map((stat) => (
                <div key={stat.label} className="payment-stat-box">
                  <p className="payment-stat-label">{stat.label}</p>
                  <p className="payment-stat-value">{formatINR(stat.revenue)}</p>
                  <p className="payment-stat-pct">{stat.revenuePct.toFixed(1)}% of Revenue</p>
                  <p className="text-muted text-sm" style={{ marginTop: 'var(--space-1)' }}>
                    {stat.orders.toLocaleString('en-IN')} orders ({stat.orderPct.toFixed(1)}%)
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Row 3 — Revenue by Fulfillment Channel */}
      <section aria-label="Revenue by Fulfillment Channel">
        <div className="card">
          <h3 className="section-title"><Truck size={18} className="inline-icon" /> Revenue by Fulfillment Channel</h3>
          <BarChart
            data={fulfillmentData.chartData}
            dataKey="revenue"
            formatter={formatINR}
            height={280}
            colorEachBar
          />
          <div className="dashboard-channel-table">
            <table className="mini-table" aria-label="Fulfillment channel breakdown">
              <thead>
                <tr>
                  <th>Channel</th>
                  <th className="text-right">Orders</th>
                  <th className="text-right">Revenue</th>
                  <th className="text-right">Avg Charges</th>
                </tr>
              </thead>
              <tbody>
                {fulfillmentData.tableData.map((row) => (
                  <tr key={row.channel}>
                    <td>{row.channel}</td>
                    <td className="text-right">{row.orders.toLocaleString('en-IN')}</td>
                    <td className="text-right">{formatINR(row.revenue)}</td>
                    <td className="text-right">{formatINR(row.avgCharges)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Row 4 — Transaction Type Breakdown */}
      <section aria-label="Transaction Type Breakdown">
        <div className="card">
          <h3 className="section-title"><BarChart3 size={18} className="inline-icon" /> Transaction Type Breakdown</h3>
          <BarChart
            data={transactionData}
            dataKey="count"
            layout="vertical"
            height={200}
            formatter={(v) => v.toLocaleString('en-IN') + ' orders'}
            colorEachBar
          />
        </div>
      </section>

      {/* Row 5 — Settlement Trend */}
      <section aria-label="Revenue Trend by Settlement">
        <div className="card">
          <h3 className="section-title"><TrendingUp size={18} className="inline-icon" /> Revenue Trend by Settlement</h3>
          <LineChart
            data={settlementTrend}
            dataKey="value"
            formatter={formatINR}
            height={280}
          />
        </div>
      </section>

      {/* Row 6 — Orders by Day of Week */}
      <section aria-label="Orders by Day of Week">
        <div className="card">
          <h3 className="section-title"><Calendar size={18} className="inline-icon" /> Orders by Day of Week</h3>
          <BarChart
            data={dayOfWeekData}
            dataKey="orders"
            height={220}
            colorEachBar
          />
        </div>
      </section>

      {/* Row 7 — GSTN Summary Table */}
      <section aria-label="GSTN-wise Summary">
        <div className="card">
          <h3 className="section-title"><Landmark size={18} className="inline-icon" /> GSTN-wise Summary</h3>
          <div className="gstn-table-scroll">
            <table className="gstn-table" aria-label="GSTN summary">
              <thead>
                <tr>
                  <th>Seller GSTN</th>
                  <th className="text-right">Taxable</th>
                  <th className="text-right">GST</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">Charges</th>
                  <th className="text-right">Total Received</th>
                </tr>
              </thead>
              <tbody>
                {gstnData.rows.map((row) => (
                  <tr key={row.gstn}>
                    <td className="gstn-col">{row.gstn || 'Unattributed / Account Level'}</td>
                    <td className="text-right">{formatINR(row.taxable)}</td>
                    <td className="text-right">{formatINR(row.gst)}</td>
                    <td className="text-right">{formatINR(row.total)}</td>
                    <td className="text-right">{formatINR(row.charges)}</td>
                    <td className="text-right">{formatINR(row.totalReceived)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="gstn-grand-total">
                  <td><strong>GRAND TOTAL</strong></td>
                  <td className="text-right"><strong>{formatINR(gstnData.totals.taxable)}</strong></td>
                  <td className="text-right"><strong>{formatINR(gstnData.totals.gst)}</strong></td>
                  <td className="text-right"><strong>{formatINR(gstnData.totals.total)}</strong></td>
                  <td className="text-right"><strong>{formatINR(gstnData.totals.charges)}</strong></td>
                  <td className="text-right"><strong>{formatINR(gstnData.totals.totalReceived)}</strong></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

// ---- Computation helpers ----

function computeShopifyInsights(records: any[]) {
  const grossSales = records.reduce((s, r) => s + (r.sales ?? 0), 0);
  const totalSales = records.reduce((s, r) => s + (r.total ?? 0), 0);
  const taxableAmount = records.reduce((s, r) => s + (r.taxable_amount ?? 0), 0);
  const gstCollected = records.reduce((s, r) => s + (r.total_gst ?? 0), 0);
  const orderCount = new Set(records.map((r) => r.invoice_no).filter(Boolean)).size;
  const unitsSold = records.reduce((s, r) => s + (r.qty ?? 0), 0);
  const aov = orderCount > 0 ? totalSales / orderCount : 0;
  const shippingCharges = records.reduce((s, r) => s + (r.other_charges ?? 0) + (r.other_charges1 ?? 0), 0);

  // 2. GST Breakdown (IGST vs Local CGST/SGST)
  const totalIgst = records.reduce((s, r) => s + (r.igst ?? 0), 0);
  const totalCgst = records.reduce((s, r) => s + (r.cgst ?? 0), 0);
  const totalSgst = records.reduce((s, r) => s + (r.sgst ?? 0), 0);
  const intrastateGst = totalCgst + totalSgst;
  
  const gstBreakdown = [
    { name: 'Interstate (IGST)', value: totalIgst },
    { name: 'Intrastate (CGST+SGST)', value: intrastateGst },
  ].filter(d => d.value > 0);

  // 3. Top SKUs by Revenue
  const skuRevenueMap = new Map<string, { revenue: number; qty: number }>();
  for (const r of records) {
    if (!r.sku) continue;
    const curr = skuRevenueMap.get(r.sku) ?? { revenue: 0, qty: 0 };
    skuRevenueMap.set(r.sku, {
      revenue: curr.revenue + (r.total ?? 0),
      qty: curr.qty + (r.qty ?? 0)
    });
  }
  const topSkus = Array.from(skuRevenueMap.entries())
    .map(([sku, data]) => ({ name: sku, value: Math.round(data.revenue), qty: data.qty }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  // 4. Payment Method Share
  const payMap = new Map<string, number>();
  const seenOrders = new Set<string>();
  for (const r of records) {
    const orderId = r.invoice_no ?? '';
    if (seenOrders.has(orderId)) continue;
    seenOrders.add(orderId);
    const pm = String(r.payment_method ?? 'Unknown').trim().toUpperCase();
    const friendlyName = pm.includes('COD') ? 'COD' : pm.includes('PREPAID') || pm.includes('ONLINE') || pm.includes('RAZORPAY') || pm.includes('UPI') ? 'Prepaid' : 'Other';
    payMap.set(friendlyName, (payMap.get(friendlyName) ?? 0) + 1);
  }
  const totalOrders = seenOrders.size;
  const paymentMethods = Array.from(payMap.entries()).map(([name, count]) => ({
    name,
    value: count,
    pct: totalOrders > 0 ? (count / totalOrders) * 100 : 0
  }));

  // 5. Regional Sales (based on Billing Party Code or Entity)
  const billingMap = new Map<string, { taxable: number; gst: number; total: number }>();
  for (const r of records) {
    const key = r.billing_party_code || 'B2C / Consumer';
    const curr = billingMap.get(key) ?? { taxable: 0, gst: 0, total: 0 };
    billingMap.set(key, {
      taxable: curr.taxable + (r.taxable_amount ?? 0),
      gst: curr.gst + (r.total_gst ?? 0),
      total: curr.total + (r.total ?? 0)
    });
  }
  const billingParties = Array.from(billingMap.entries())
    .map(([gstn, val]) => ({ gstn, ...val }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  // 6. Daily trend
  const dailyMap = new Map<string, number>();
  for (const r of records) {
    if (!r.date) continue;
    dailyMap.set(r.date, (dailyMap.get(r.date) ?? 0) + (r.total ?? 0));
  }
  const dailyTrend = Array.from(dailyMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, value]) => ({
      name: formatDateTime(date),
      value
    }));

  // 7. SKU unit economics
  const skuEconomicsMap = new Map<string, { qty: number; taxableSales: number; otherCharges: number; gst: number; total: number }>();
  for (const r of records) {
    if (!r.sku) continue;
    const curr = skuEconomicsMap.get(r.sku) ?? { qty: 0, taxableSales: 0, otherCharges: 0, gst: 0, total: 0 };
    skuEconomicsMap.set(r.sku, {
      qty: curr.qty + (r.qty ?? 0),
      taxableSales: curr.taxableSales + (r.taxable_amount ?? 0),
      otherCharges: curr.otherCharges + (r.other_charges ?? 0) + (r.other_charges1 ?? 0),
      gst: curr.gst + (r.total_gst ?? 0),
      total: curr.total + (r.total ?? 0),
    });
  }
  const skuEconomics = Array.from(skuEconomicsMap.entries()).map(([sku, data]) => {
    const asp = data.qty > 0 ? data.taxableSales / data.qty : 0;
    const chargesPct = data.taxableSales > 0 ? (data.otherCharges / data.taxableSales) * 100 : 0;
    return {
      sku,
      ...data,
      asp,
      chargesPct,
    };
  }).sort((a, b) => b.taxableSales - a.taxableSales);

  return { grossSales, totalSales, taxableAmount, gstCollected, orderCount, unitsSold, aov, shippingCharges, gstBreakdown, topSkus, paymentMethods, billingParties, dailyTrend, skuEconomics };
}

function computeKpis(records: any[], platform?: string) {
  if (platform === 'shopify') {
    const totalRevenue = records.reduce((s, r) => s + (r.total ?? 0), 0);
    const totalTaxable = records.reduce((s, r) => s + (r.taxable_amount ?? 0), 0);
    const totalOrders = new Set(records.map((r) => r.invoice_no).filter(Boolean)).size;
    const unitsSold = records.reduce((s, r) => s + (r.qty ?? 0), 0);
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    const netReceived = totalRevenue; 
    const totalCharges = records.reduce((s, r) => s + (r.other_charges ?? 0) + (r.other_charges1 ?? 0), 0);
    const totalRefunds = 0;
    const refundRate = 0;
    return { totalRevenue, totalTaxable, totalOrders, unitsSold, avgOrderValue, netReceived, totalCharges, totalRefunds, refundRate };
  }

  const shipments = records.filter((r) => r.transaction_type === SHIPMENT);
  const refunds = records.filter((r) => r.transaction_type && REFUND_TYPES.includes(r.transaction_type));

  const totalRevenue = records.reduce((s, r) => s + (r.invoice_amount ?? 0), 0);
  const grossRevenue = shipments.reduce((s, r) => s + (r.invoice_amount ?? 0), 0);
  const totalTaxable = records.reduce((s, r) => s + (r.tax_exclusive_amount ?? 0), 0);
  const totalOrders = new Set(shipments.map((r) => r.order_id).filter(Boolean)).size;
  const unitsSold = shipments.reduce((s, r) => s + (r.quantity ?? 0), 0);
  const avgOrderValue = totalOrders > 0 ? grossRevenue / totalOrders : 0;
  const netReceived = records.reduce((s, r) => s + (r.total ?? 0), 0);
  const totalCharges = records.reduce((s, r) => s + (r.charges ?? 0), 0);
  const totalRefunds = refunds.reduce((s, r) => s + (r.invoice_amount ?? 0), 0);

  const allOrderIds = new Set(records.map((r) => r.order_id).filter(Boolean));
  const refundOrderIds = new Set(refunds.map((r) => r.order_id).filter(Boolean));
  const refundRate = allOrderIds.size > 0 ? (refundOrderIds.size / allOrderIds.size) * 100 : 0;

  return { totalRevenue, totalTaxable, totalOrders, unitsSold, avgOrderValue, netReceived, totalCharges, totalRefunds, refundRate };
}

function computeExtraKpis(records: any[], platform?: string) {
  if (platform === 'shopify') {
    const totalRevenue = records.reduce((s, r) => s + (r.total ?? 0), 0);
    const unitsSold = records.reduce((s, r) => s + (r.qty ?? 0), 0);
    const totalCharges = records.reduce((s, r) => s + (r.other_charges ?? 0) + (r.other_charges1 ?? 0), 0);
    const avgPricePerUnit = unitsSold > 0 ? totalRevenue / unitsSold : 0;
    const grossMargin = totalRevenue > 0 ? ((totalRevenue - totalCharges) / totalRevenue) * 100 : 100;
    const avgSettlementLag = 0;
    
    const revenueByDay = new Map<string, number>();
    for (const r of records) {
      if (r.date) {
        const curr = revenueByDay.get(r.date) ?? 0;
        revenueByDay.set(r.date, curr + (r.total ?? 0));
      }
    }
    let topRevenueDay = '';
    let topRevenue = 0;
    for (const [day, rev] of revenueByDay.entries()) {
      if (rev > topRevenue) { topRevenue = rev; topRevenueDay = day; }
    }
    return { avgPricePerUnit, grossMargin, avgSettlementLag, topRevenueDay };
  }

  const shipments = records.filter((r) => r.transaction_type === SHIPMENT);
  const totalRevenue = records.reduce((s, r) => s + (r.invoice_amount ?? 0), 0);
  const grossRevenue = shipments.reduce((s, r) => s + (r.invoice_amount ?? 0), 0);
  const unitsSold = shipments.reduce((s, r) => s + (r.quantity ?? 0), 0);
  const totalCharges = records.reduce((s, r) => s + (r.charges ?? 0), 0);

  const avgPricePerUnit = unitsSold > 0 ? grossRevenue / unitsSold : 0;
  const grossMargin = totalRevenue > 0 ? ((totalRevenue - Math.abs(totalCharges)) / totalRevenue) * 100 : 0;

  // Settlement lag
  const lags: number[] = [];
  for (const r of records) {
    if (r.order_date && r.deposit_date) {
      try {
        const od = parseISO(r.order_date);
        const dd = parseISO(r.deposit_date);
        if (isValid(od) && isValid(dd)) {
          const diff = differenceInDays(dd, od);
          if (diff >= 0 && diff < 365) lags.push(diff);
        }
      } catch {
        // Ignore parse errors
      }
    }
  }
  const avgSettlementLag = lags.length > 0 ? lags.reduce((a, b) => a + b, 0) / lags.length : 0;

  // Top revenue day
  const revenueByDay = new Map<string, number>();
  for (const r of shipments) {
    if (r.order_date) {
      const curr = revenueByDay.get(r.order_date) ?? 0;
      revenueByDay.set(r.order_date, curr + (r.invoice_amount ?? 0));
    }
  }
  let topRevenueDay = '';
  let topRevenue = 0;
  for (const [day, rev] of revenueByDay.entries()) {
    if (rev > topRevenue) { topRevenue = rev; topRevenueDay = day; }
  }

  return { avgPricePerUnit, grossMargin, avgSettlementLag, topRevenueDay };
}

function computePaymentData(records: any[], platform?: string) {
  if (platform === 'shopify') {
    const counts: Record<string, number> = { COD: 0, Prepaid: 0, Unknown: 0 };
    const seenOrders = new Set<string>();

    for (const r of records) {
      const orderId = r.invoice_no ?? '';
      if (seenOrders.has(orderId)) continue;
      seenOrders.add(orderId);
      
      const pm = String(r.payment_method ?? '').toUpperCase();
      let pt = 'Unknown';
      if (pm.includes('COD') || pm.includes('DELIVERY')) {
        pt = 'COD';
      } else if (pm.includes('PREPAID') || pm.includes('ONLINE') || pm.includes('UPI') || pm.includes('CARD') || pm.includes('RAZORPAY')) {
        pt = 'Prepaid';
      }
      counts[pt] = (counts[pt] ?? 0) + 1;
    }

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const chartData = Object.entries(counts)
      .filter(([, v]) => v > 0)
      .map(([name, value]) => ({ name, value }));

    const stats = Object.entries(counts).map(([label, count]) => ({
      label: label + ' Orders',
      count,
      pct: total > 0 ? (count / total) * 100 : 0,
    }));

    return { chartData, stats };
  }

  const counts: Record<string, number> = { COD: 0, Prepaid: 0, Unknown: 0 };
  const seenOrders = new Set<string>();

  for (const r of records) {
    if (r.transaction_type !== SHIPMENT) continue;
    const orderId = r.order_id ?? r.invoice_no ?? '';
    if (seenOrders.has(orderId)) continue;
    seenOrders.add(orderId);
    const pt = r.payment_type ?? 'Unknown';
    counts[pt] = (counts[pt] ?? 0) + 1;
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  const chartData = Object.entries(counts)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value }));

  const stats = Object.entries(counts).map(([label, count]) => ({
    label: label + ' Orders',
    count,
    pct: total > 0 ? (count / total) * 100 : 0,
  }));

  return { chartData, stats };
}

function computeFulfillmentData(records: any[], platform?: string) {
  if (platform === 'shopify') {
    const totalRevenue = records.reduce((s, r) => s + (r.total ?? 0), 0);
    const totalOrders = new Set(records.map((r) => r.invoice_no).filter(Boolean)).size;

    const chartData = [{ name: 'Shopify Delivery', revenue: totalRevenue }];
    const tableData = [{
      channel: 'Shopify Delivery',
      orders: totalOrders,
      revenue: totalRevenue,
      avgCharges: 0
    }];
    return { chartData, tableData };
  }

  const channels = ['FBA', 'Easy Ship', 'Self Ship', 'Unknown'];
  const byChannel: Record<string, { orders: Set<string>; revenue: number; charges: number }> = {};
  channels.forEach((c) => {
    byChannel[c] = { orders: new Set(), revenue: 0, charges: 0 };
  });

  for (const r of records) {
    if (r.transaction_type !== SHIPMENT) continue;
    const ch = r.fulfillment_channel ?? 'Unknown';
    const key = ch in byChannel ? ch : 'Unknown';
    const orderId = r.order_id ?? r.invoice_no ?? '';
    byChannel[key].orders.add(orderId);
    byChannel[key].revenue += r.invoice_amount ?? 0;
    byChannel[key].charges += r.charges ?? 0;
  }

  const chartData = channels
    .filter((c) => byChannel[c].revenue > 0)
    .map((c) => ({ name: c, revenue: byChannel[c].revenue }));

  const tableData = channels
    .filter((c) => byChannel[c].orders.size > 0)
    .map((c) => ({
      channel: c,
      orders: byChannel[c].orders.size,
      revenue: byChannel[c].revenue,
      avgCharges: byChannel[c].orders.size > 0 ? byChannel[c].charges / byChannel[c].orders.size : 0,
    }));

  return { chartData, tableData };
}

function computeTransactionData(records: any[], platform?: string) {
  if (platform === 'shopify') {
    const totalOrders = new Set(records.map((r) => r.invoice_no).filter(Boolean)).size;
    return [{ name: 'Store Sale', count: totalOrders }];
  }

  const types: Record<string, number> = {};
  const seenOrders = new Set<string>();

  for (const r of records) {
    const orderId = r.order_id ?? r.invoice_no;
    const key = `${orderId}:${r.transaction_type}`;
    if (seenOrders.has(key)) continue;
    seenOrders.add(key);
    const tt = r.transaction_type ?? 'Unknown';
    types[tt] = (types[tt] ?? 0) + 1;
  }

  return Object.entries(types).map(([name, count]) => ({ name, count }));
}

function computeGstnData(records: any[], platform?: string) {
  if (platform === 'shopify') {
    const byGstn: Record<string, { taxable: number; gst: number; total: number; charges: number; totalReceived: number }> = {};

    for (const r of records) {
      const gstn = r.billing_party_code || 'Unattributed / B2C';
      if (!byGstn[gstn]) {
        byGstn[gstn] = { taxable: 0, gst: 0, total: 0, charges: 0, totalReceived: 0 };
      }
      byGstn[gstn].taxable += r.taxable_amount ?? 0;
      byGstn[gstn].gst += r.total_gst ?? 0;
      byGstn[gstn].total += r.total ?? 0;
      byGstn[gstn].charges += (r.other_charges ?? 0) + (r.other_charges1 ?? 0);
      byGstn[gstn].totalReceived += r.total ?? 0;
    }

    const rows = Object.entries(byGstn).map(([gstn, v]) => ({ gstn, ...v }));

    const totals = rows.reduce(
      (acc, r) => ({
        taxable: acc.taxable + r.taxable,
        gst: acc.gst + r.gst,
        total: acc.total + r.total,
        charges: acc.charges + r.charges,
        totalReceived: acc.totalReceived + r.totalReceived,
      }),
      { taxable: 0, gst: 0, total: 0, charges: 0, totalReceived: 0 }
    );

    return { rows, totals };
  }

  const byGstn: Record<string, { taxable: number; gst: number; total: number; charges: number; totalReceived: number }> = {};

  for (const r of records) {
    const gstn = r.seller_gstn ?? '';
    if (!byGstn[gstn]) {
      byGstn[gstn] = { taxable: 0, gst: 0, total: 0, charges: 0, totalReceived: 0 };
    }
    byGstn[gstn].taxable += r.tax_exclusive_amount ?? 0;
    byGstn[gstn].gst += r.total_tax_amount ?? 0;
    byGstn[gstn].total += r.invoice_amount ?? 0;
    byGstn[gstn].charges += r.charges ?? 0;
    byGstn[gstn].totalReceived += r.total ?? 0;
  }

  const rows = Object.entries(byGstn).map(([gstn, v]) => ({ gstn, ...v }));

  const totals = rows.reduce(
    (acc, r) => ({
      taxable: acc.taxable + r.taxable,
      gst: acc.gst + r.gst,
      total: acc.total + r.total,
      charges: acc.charges + r.charges,
      totalReceived: acc.totalReceived + r.totalReceived,
    }),
    { taxable: 0, gst: 0, total: 0, charges: 0, totalReceived: 0 }
  );

  return { rows, totals };
}

function parseDateRobust(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  const cleanStr = dateStr.trim();
  const dmMatch = cleanStr.match(/^(\d{1,2})-(\d{1,2})-(\d{4})(?:\s+(\d{1,2}):(\d{1,2}))?/);
  if (dmMatch) {
    const day = parseInt(dmMatch[1], 10);
    const month = parseInt(dmMatch[2], 10) - 1;
    const year = parseInt(dmMatch[3], 10);
    const hour = dmMatch[4] ? parseInt(dmMatch[4], 10) : 0;
    const min = dmMatch[5] ? parseInt(dmMatch[5], 10) : 0;
    return new Date(year, month, day, hour, min);
  }
  const d = new Date(cleanStr);
  return isNaN(d.getTime()) ? null : d;
}

function computeSettlementTrend(records: any[], platform?: string) {
  if (platform === 'shopify') {
    const byDate: Record<string, { revenue: number; date: string }> = {};

    for (const r of records) {
      if (!r.date) continue;
      if (!byDate[r.date]) {
        byDate[r.date] = { revenue: 0, date: r.date };
      }
      byDate[r.date].revenue += r.total ?? 0;
    }

    return Object.entries(byDate)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, v]) => ({
        name: formatDateTime(v.date),
        value: v.revenue,
      }));
  }

  const bySettlement: Record<string, { revenue: number; date: string }> = {};

  for (const r of records) {
    if (r.transaction_type !== SHIPMENT) continue;
    const sid = r.settlement_id ?? 'Unknown';
    if (!bySettlement[sid]) {
      bySettlement[sid] = { revenue: 0, date: r.deposit_date ?? sid };
    }
    bySettlement[sid].revenue += r.invoice_amount ?? 0;
  }

  return Object.entries(bySettlement)
    .sort(([, a], [, b]) => a.date.localeCompare(b.date))
    .map(([, v]) => ({
      name: v.date !== 'Unknown' ? formatDateTime(v.date) : 'Unknown',
      value: v.revenue,
    }));
}

function computeDayOfWeekData(records: any[], platform?: string) {
  const counts = [0, 0, 0, 0, 0, 0, 0];

  if (platform === 'shopify') {
    const seenOrders = new Set<string>();

    for (const r of records) {
      const orderId = r.invoice_no ?? '';
      if (seenOrders.has(orderId)) continue;
      seenOrders.add(orderId);
      
      if (!r.date) continue;
      const d = parseDateRobust(r.date);
      if (d) {
        counts[d.getDay()]++;
      }
    }

    return DAY_NAMES.map((name, i) => ({ name, orders: counts[i] }));
  }

  for (const r of records) {
    if (r.transaction_type !== SHIPMENT || !r.order_date) continue;
    const d = parseDateRobust(r.order_date);
    if (d) {
      counts[d.getDay()]++;
    }
  }

  return DAY_NAMES.map((name, i) => ({ name, orders: counts[i] }));
}

function computeTypeData(records: any[], platform?: string) {
  if (platform === 'shopify') {
    const counts = { B2C: 0, B2B: 0 };
    const revenue = { B2C: 0, B2B: 0 };
    const seenOrders = new Set<string>();

    for (const r of records) {
      const isB2B = r.billing_party_code && r.billing_party_code !== 'Consumer' && r.billing_party_code.trim().length === 15;
      const key = isB2B ? 'B2B' : 'B2C';

      revenue[key] += r.total ?? 0;
      const orderId = r.invoice_no ?? '';
      if (!seenOrders.has(orderId)) {
        seenOrders.add(orderId);
        counts[key]++;
      }
    }

    const totalOrders = counts.B2C + counts.B2B;
    const totalRevenue = revenue.B2C + revenue.B2B;

    const chartData = [
      { name: 'B2C Sales', value: revenue.B2C },
      { name: 'B2B Sales', value: revenue.B2B },
    ].filter((d) => d.value > 0);

    const stats = [
      {
        label: 'B2C Sales',
        orders: counts.B2C,
        orderPct: totalOrders > 0 ? (counts.B2C / totalOrders) * 100 : 0,
        revenue: revenue.B2C,
        revenuePct: totalRevenue > 0 ? (revenue.B2C / totalRevenue) * 100 : 0,
      },
      {
        label: 'B2B Sales',
        orders: counts.B2B,
        orderPct: totalOrders > 0 ? (counts.B2B / totalOrders) * 100 : 0,
        revenue: revenue.B2B,
        revenuePct: totalRevenue > 0 ? (revenue.B2B / totalRevenue) * 100 : 0,
      },
    ];

    return { chartData, stats };
  }

  const counts = { B2C: 0, B2B: 0 };
  const revenue = { B2C: 0, B2B: 0 };
  const seenOrders = new Set<string>();

  for (const r of records) {
    const isB2B = r.type === 'B2B';
    const key = isB2B ? 'B2B' : 'B2C';

    // Add to revenue and order count
    if (r.transaction_type === SHIPMENT) {
      revenue[key] += r.invoice_amount ?? 0;
      const orderId = r.order_id ?? r.invoice_no ?? '';
      if (!seenOrders.has(orderId)) {
        seenOrders.add(orderId);
        counts[key]++;
      }
    }
  }

  const totalOrders = counts.B2C + counts.B2B;
  const totalRevenue = revenue.B2C + revenue.B2B;

  const chartData = [
    { name: 'B2C Sales', value: revenue.B2C },
    { name: 'B2B Sales', value: revenue.B2B },
  ].filter((d) => d.value > 0);

  const stats = [
    {
      label: 'B2C Sales',
      orders: counts.B2C,
      orderPct: totalOrders > 0 ? (counts.B2C / totalOrders) * 100 : 0,
      revenue: revenue.B2C,
      revenuePct: totalRevenue > 0 ? (revenue.B2C / totalRevenue) * 100 : 0,
    },
    {
      label: 'B2B Sales',
      orders: counts.B2B,
      orderPct: totalOrders > 0 ? (counts.B2B / totalOrders) * 100 : 0,
      revenue: revenue.B2B,
      revenuePct: totalRevenue > 0 ? (revenue.B2B / totalRevenue) * 100 : 0,
    },
  ];

  return { chartData, stats };
}
