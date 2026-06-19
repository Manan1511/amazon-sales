import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

/** Chart palette from design tokens */
const COLORS = [
  '#3B82F6',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#8B5CF6',
  '#06B6D4',
  '#F97316',
  '#64748B',
];

interface DonutDataPoint {
  name: string;
  value: number;
}

interface DonutChartProps {
  data: DonutDataPoint[];
  loading?: boolean;
  emptyMessage?: string;
  height?: number;
  innerRadius?: number;
  outerRadius?: number;
  formatter?: (value: number) => string;
  showLabels?: boolean;
}

interface LabelProps {
  cx: number;
  cy: number;
  midAngle: number;
  innerRadius: number;
  outerRadius: number;
  percent: number;
}

const RADIAN = Math.PI / 180;

function renderCustomLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }: LabelProps) {
  if (percent < 0.05) return null;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={700}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

export function DonutChart({
  data,
  loading = false,
  emptyMessage = 'No data available',
  height = 300,
  innerRadius = 70,
  outerRadius = 120,
  formatter,
  showLabels = true,
}: DonutChartProps) {
  if (loading) {
    return (
      <div
        className="skeleton"
        style={{ height, borderRadius: 'var(--radius-lg)' }}
        role="status"
        aria-label="Loading chart"
      />
    );
  }

  if (!data.length || data.every((d) => d.value === 0)) {
    return (
      <div className="empty-state" style={{ height }}>
        <span className="empty-state-icon">📊</span>
        <p className="empty-state-title">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={innerRadius}
          outerRadius={outerRadius}
          dataKey="value"
          labelLine={false}
          label={showLabels ? (renderCustomLabel as unknown as boolean) : false}
          isAnimationActive={true}
          animationDuration={800}
        >
          {data.map((_entry, index) => (
            <Cell
              key={`cell-${index}`}
              fill={COLORS[index % COLORS.length]}
              stroke="white"
              strokeWidth={2}
            />
          ))}
        </Pie>
        <Tooltip
          formatter={(value: any) =>
            formatter ? formatter(Number(value)) : value.toLocaleString('en-IN')
          }
          contentStyle={{
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-md)',
            fontSize: 13,
          }}
        />
        <Legend
          wrapperStyle={{ fontSize: 13, fontFamily: 'Inter, sans-serif' }}
          iconType="circle"
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
