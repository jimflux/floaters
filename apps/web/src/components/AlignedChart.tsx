import { useState, useCallback } from 'react';

const COL_WIDTH = 100;
const CHART_HEIGHT = 180;
const PADDING_TOP = 20;
const PADDING_BOTTOM = 30;
const AXIS_LABEL_X = 4;

function formatGBP(n: number): string {
  const abs = Math.abs(Math.round(n));
  const formatted = abs.toLocaleString('en-GB');
  return n < 0 ? `-£${formatted}` : `£${formatted}`;
}

interface AlignedChartProps {
  months: string[];
  closingBalance: number[];
  currentMonthIndex: number;
  formatMonth: (m: string) => string;
  colWidth?: number;
}

export default function AlignedChart({
  months,
  closingBalance,
  currentMonthIndex,
  formatMonth,
  colWidth = COL_WIDTH,
}: AlignedChartProps) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; month: string; value: number } | null>(null);

  const chartValues = months.map((_, i) => closingBalance[i] ?? closingBalance[closingBalance.length - 1] ?? 0);
  const halfCol = colWidth / 2;
  const svgWidth = months.length * colWidth;
  const plotHeight = CHART_HEIGHT - PADDING_TOP - PADDING_BOTTOM;

  const minVal = Math.min(...chartValues);
  const maxVal = Math.max(...chartValues);
  const rawRange = maxVal - Math.min(0, minVal) || 1;

  // Nice step algorithm
  const niceStep = (range: number, ticks: number): number => {
    const rough = range / (ticks - 1);
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const norm = rough / mag;
    let nice: number;
    if (norm <= 1) nice = 1;
    else if (norm <= 2) nice = 2;
    else if (norm <= 2.5) nice = 2.5;
    else if (norm <= 5) nice = 5;
    else nice = 10;
    return nice * mag;
  };

  const tickCount = 5;
  const step = niceStep(rawRange, tickCount);
  const yMin = Math.floor(Math.min(0, minVal) / step) * step;
  const yMax = Math.ceil(maxVal / step) * step;

  const toX = (i: number) => i * colWidth + halfCol;
  const toY = (v: number) => PADDING_TOP + plotHeight - ((v - yMin) / (yMax - yMin)) * plotHeight;

  const yTicks: { value: number; y: number }[] = [];
  for (let v = yMin; v <= yMax + step * 0.01; v += step) {
    const val = Math.round(v);
    yTicks.push({ value: val, y: toY(val) });
  }

  const points = chartValues.map((v, i) => ({ x: toX(i), y: toY(v), value: v }));

  // Area path
  const areaPath = `M 0 ${PADDING_TOP + plotHeight} ` +
    `L ${points[0].x} ${points[0].y} ` +
    points.map(p => `L ${p.x} ${p.y}`).join(' ') +
    ` L ${svgWidth} ${PADDING_TOP + plotHeight} Z`;

  // Historical line (0 to currentMonthIndex)
  const histPoints = points.slice(0, currentMonthIndex + 1);
  const histLine = histPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  // Future line (currentMonthIndex onward)
  const futPoints = points.slice(currentMonthIndex);
  const futLine = futPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (svgWidth / rect.width);
    const idx = Math.round((x - halfCol) / colWidth);
    if (idx >= 0 && idx < months.length) {
      setTooltip({ x: points[idx].x, y: points[idx].y, month: formatMonth(months[idx]), value: chartValues[idx] });
    }
  }, [months, points, chartValues, formatMonth, colWidth, halfCol, svgWidth]);

  return (
    <div className="relative w-full" style={{ height: CHART_HEIGHT }}>
      <svg
        width="100%"
        height={CHART_HEIGHT}
        viewBox={`0 0 ${svgWidth} ${CHART_HEIGHT}`}
        preserveAspectRatio="none"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setTooltip(null)}
        className="overflow-visible"
      >
        {/* Y-axis labels */}
        {months.map((m, i) => (
          i === currentMonthIndex ? (
            <rect
              key={`month-highlight-${m}`}
              x={i * colWidth}
              y={0}
              width={colWidth}
              height={CHART_HEIGHT}
              fill="hsl(var(--col-highlight))"
            />
          ) : null
        ))}

        {/* Y-axis labels */}
        {yTicks.map((t, i) => (
          <text
            key={`label-${i}`}
            x={AXIS_LABEL_X}
            y={t.y + 3}
            textAnchor="start"
            fill="hsl(var(--muted-foreground))"
            fontSize={10}
          >
            {formatGBP(t.value)}
          </text>
        ))}

        {/* Grid lines */}
        {yTicks.map((t, i) => (
          <line key={i} x1={0} x2={svgWidth} y1={t.y} y2={t.y} stroke="hsl(var(--border))" strokeWidth={1} />
        ))}

        {/* Area fill */}
        <path d={areaPath} fill="hsl(210 100% 60% / 0.08)" />

        {/* Historical line */}
        {histPoints.length > 1 && (
          <path d={histLine} fill="none" stroke="hsl(var(--foreground))" strokeWidth={2} />
        )}

        {/* Future line (dashed) */}
        {futPoints.length > 1 && (
          <path d={futLine} fill="none" stroke="hsl(var(--foreground))" strokeWidth={2} strokeDasharray="6 3" />
        )}

        {/* Current month dot */}
        <circle
          cx={points[currentMonthIndex].x}
          cy={points[currentMonthIndex].y}
          r={5}
          fill="hsl(var(--foreground))"
          stroke="hsl(var(--background))"
          strokeWidth={2}
        />

        {/* Tooltip crosshair */}
        {tooltip && (
          <>
            <line x1={tooltip.x} x2={tooltip.x} y1={PADDING_TOP} y2={PADDING_TOP + plotHeight} stroke="hsl(var(--muted-foreground))" strokeWidth={1} strokeDasharray="3 3" />
            <circle cx={tooltip.x} cy={tooltip.y} r={4} fill="hsl(var(--primary))" stroke="hsl(var(--background))" strokeWidth={2} />
          </>
        )}
      </svg>

      {/* Y-axis labels (positioned absolute left, rendered in the sticky area by parent) */}

      {/* Tooltip popup */}
      {tooltip && (
        <div
          className="absolute pointer-events-none bg-card border border-border rounded-md px-2 py-1 text-xs shadow-sm z-20"
          style={{
            left: `${(tooltip.x / svgWidth) * 100}%`,
            top: tooltip.y - 40,
            transform: 'translateX(-50%)',
          }}
        >
          <div className="text-muted-foreground">{tooltip.month}</div>
          <div className="font-semibold tabular-nums">{formatGBP(tooltip.value)}</div>
        </div>
      )}
    </div>
  );
}

export { COL_WIDTH, CHART_HEIGHT };
