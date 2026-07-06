import { useState, useCallback } from 'react';

const COL_WIDTH = 100;
const CHART_HEIGHT = 180;
const PADDING_TOP = 20;
const PADDING_BOTTOM = 30;
const AXIS_LABEL_X = 4;

// The optimistic (projections land) series: visually lighter than committed.
const OPTIMISTIC_STROKE = 'hsl(38 92% 50%)';
const OPTIMISTIC_BAND_FILL = 'hsl(38 92% 50% / 0.08)';

function formatGBP(n: number): string {
  const abs = Math.abs(Math.round(n));
  const formatted = abs.toLocaleString('en-GB');
  return n < 0 ? `-£${formatted}` : `£${formatted}`;
}

interface AlignedChartProps {
  months: string[];
  closingBalance: number[]; // committed: the headline series
  optimisticClosing?: number[]; // committed + unfulfilled projections
  currentMonthIndex: number;
  formatMonth: (m: string) => string;
  colWidth?: number;
}

export default function AlignedChart({
  months,
  closingBalance,
  optimisticClosing,
  currentMonthIndex,
  formatMonth,
  colWidth = COL_WIDTH,
}: AlignedChartProps) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; month: string; value: number; optimistic: number } | null>(null);

  const chartValues = months.map((_, i) => closingBalance[i] ?? closingBalance[closingBalance.length - 1] ?? 0);
  const optValues = months.map((_, i) => optimisticClosing?.[i] ?? chartValues[i]);
  // Both walks share an identical history; the band only exists when
  // projections actually separate them.
  const hasDivergence = optValues.some((v, i) => Math.abs(v - chartValues[i]) > 0.005);

  const halfCol = colWidth / 2;
  const svgWidth = months.length * colWidth;
  const plotHeight = CHART_HEIGHT - PADDING_TOP - PADDING_BOTTOM;

  const minVal = Math.min(...chartValues, ...optValues);
  const maxVal = Math.max(...chartValues, ...optValues);
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
  const optPoints = optValues.map((v, i) => ({ x: toX(i), y: toY(v), value: v }));

  // Area path
  const areaPath = `M 0 ${PADDING_TOP + plotHeight} ` +
    `L ${points[0].x} ${points[0].y} ` +
    points.map(p => `L ${p.x} ${p.y}`).join(' ') +
    ` L ${svgWidth} ${PADDING_TOP + plotHeight} Z`;

  // Historical line ends at the previous month's closing: the current month's
  // closing is a projected month-end, so it belongs to the dashed segment
  const histPoints = points.slice(0, Math.max(currentMonthIndex, 1));
  const histLine = histPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  // Projected line (previous month's closing onward)
  const futPoints = points.slice(Math.max(currentMonthIndex - 1, 0));
  const futLine = futPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  // Optimistic line: shares the identical historical path, so only its
  // divergent stretch is drawn — from the previous month's anchor onward.
  const optFutPoints = optPoints.slice(Math.max(currentMonthIndex - 1, 0));
  const optLine = optFutPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  // The band between committed and optimistic: forward along committed,
  // back along optimistic.
  const bandPath =
    futPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') +
    ' ' +
    [...optFutPoints].reverse().map(p => `L ${p.x} ${p.y}`).join(' ') +
    ' Z';

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (svgWidth / rect.width);
    const idx = Math.round((x - halfCol) / colWidth);
    if (idx >= 0 && idx < months.length) {
      setTooltip({ x: points[idx].x, y: points[idx].y, month: formatMonth(months[idx]), value: chartValues[idx], optimistic: optValues[idx] });
    }
  }, [months, points, chartValues, optValues, formatMonth, colWidth, halfCol, svgWidth]);

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
        {/* Current month highlight */}
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

        {/* Optimistic band (the visible risk gap) */}
        {hasDivergence && optFutPoints.length > 1 && (
          <path data-testid="optimistic-band" d={bandPath} fill={OPTIMISTIC_BAND_FILL} />
        )}

        {/* Historical line */}
        {histPoints.length > 1 && (
          <path d={histLine} fill="none" stroke="hsl(var(--foreground))" strokeWidth={2} />
        )}

        {/* Future line (dashed) */}
        {futPoints.length > 1 && (
          <path d={futLine} fill="none" stroke="hsl(var(--foreground))" strokeWidth={2} strokeDasharray="6 3" />
        )}

        {/* Optimistic line (lighter, dashed) */}
        {hasDivergence && optFutPoints.length > 1 && (
          <path data-testid="optimistic-line" d={optLine} fill="none" stroke={OPTIMISTIC_STROKE} strokeWidth={1.5} strokeDasharray="3 4" />
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

      {/* Legend: only when the lines actually separate */}
      {hasDivergence && (
        <div className="absolute top-1 right-2 flex items-center gap-3 text-[10px] text-muted-foreground bg-card/80 rounded px-1.5 py-0.5 pointer-events-none">
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 border-t-2 border-foreground" />
            Committed
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 border-t-2 border-dashed" style={{ borderColor: OPTIMISTIC_STROKE }} />
            If projections land
          </span>
        </div>
      )}

      {/* Tooltip popup */}
      {tooltip && (
        <div
          className="absolute pointer-events-none bg-card border border-border rounded-md px-2 py-1 text-xs shadow-sm z-20"
          style={{
            left: `${(tooltip.x / svgWidth) * 100}%`,
            top: tooltip.y - (Math.abs(tooltip.optimistic - tooltip.value) > 0.005 ? 56 : 40),
            transform: 'translateX(-50%)',
          }}
        >
          <div className="text-muted-foreground">{tooltip.month}</div>
          <div className="font-semibold tabular-nums">{formatGBP(tooltip.value)}</div>
          {Math.abs(tooltip.optimistic - tooltip.value) > 0.005 && (
            <div className="tabular-nums" style={{ color: OPTIMISTIC_STROKE }}>
              {formatGBP(tooltip.optimistic)} if projections land
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export { COL_WIDTH, CHART_HEIGHT };
