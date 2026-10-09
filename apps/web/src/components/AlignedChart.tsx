import { useState, useCallback } from 'react';

const COL_WIDTH = 100;
// Taller than it is wide-per-column on purpose: the chart stretches to fill the
// column-aligned width (preserveAspectRatio="none"), so a short height reads as
// a flat, squished band on wide screens. Render height stays equal to the
// viewBox height, keeping the y-axis and stroke weights undistorted.
const CHART_HEIGHT = 280;
const PADDING_TOP = 20;
const PADDING_BOTTOM = 30;
const AXIS_LABEL_X = 4;

// Series colours (Flux palette, checked on the white chart surface):
// primary balance = aubergine ink (17.4:1), optimistic = iris (4.9:1),
// spendable after VAT = coral (3.6:1). Each line also has its own dash
// pattern and a legend entry, so identity never rests on colour alone.
// The optimistic (projections land) series: visually lighter than committed.
const OPTIMISTIC_STROKE = 'hsl(var(--iris))';
const OPTIMISTIC_BAND_FILL = 'hsl(var(--iris) / 0.14)';
// Below £0 is tinted coral so a dip into the red reads at a glance.
const NEGATIVE_ZONE_FILL = 'hsl(var(--coral) / 0.10)';

function formatGBP(n: number): string {
  const abs = Math.abs(Math.round(n));
  const formatted = abs.toLocaleString('en-GB');
  return n < 0 ? `-£${formatted}` : `£${formatted}`;
}

interface AlignedChartProps {
  months: string[];
  closingBalance: number[]; // the primary (bold) series
  optimisticClosing?: number[]; // the secondary (lighter) series
  currentMonthIndex: number;
  formatMonth: (m: string) => string;
  colWidth?: number;
  // Legend/tooltip labels and the secondary line colour. Callers swap the two
  // series (and these) to major on committed vs projected without the chart
  // needing to know which is which.
  primaryLabel?: string;
  secondaryLabel?: string;
  secondaryStroke?: string;
  // Optional third line: true spendable cash net of VAT owed. Drawn thin from
  // the current month forward when supplied and it diverges from committed.
  adjustedClosing?: number[];
  adjustedLabel?: string;
  adjustedStroke?: string;
}

// Spendable-after-VAT line: coral, distinct from committed (aubergine) and
// optimistic (iris), and dotted rather than dashed.
const ADJUSTED_STROKE = 'hsl(var(--coral))';

export default function AlignedChart({
  months,
  closingBalance,
  optimisticClosing,
  currentMonthIndex,
  formatMonth,
  colWidth = COL_WIDTH,
  primaryLabel = 'Committed',
  secondaryLabel = 'If projections land',
  secondaryStroke = OPTIMISTIC_STROKE,
  adjustedClosing,
  adjustedLabel = 'Spendable (net VAT)',
  adjustedStroke = ADJUSTED_STROKE,
}: AlignedChartProps) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; month: string; value: number; optimistic: number } | null>(null);

  const chartValues = months.map((_, i) => closingBalance[i] ?? closingBalance[closingBalance.length - 1] ?? 0);
  const optValues = months.map((_, i) => optimisticClosing?.[i] ?? chartValues[i]);
  const adjValues = adjustedClosing ? months.map((_, i) => adjustedClosing[i] ?? chartValues[i]) : null;
  // Both walks share an identical history; the band only exists when
  // projections actually separate them.
  const hasDivergence = optValues.some((v, i) => Math.abs(v - chartValues[i]) > 0.005);
  const hasAdjusted = adjValues !== null && adjValues.some((v, i) => Math.abs(v - chartValues[i]) > 0.005);

  const halfCol = colWidth / 2;
  const svgWidth = months.length * colWidth;
  const plotHeight = CHART_HEIGHT - PADDING_TOP - PADDING_BOTTOM;

  const minVal = Math.min(...chartValues, ...optValues, ...(adjValues ?? []));
  const maxVal = Math.max(...chartValues, ...optValues, ...(adjValues ?? []));
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

  // VAT-adjusted (spendable) line: identical to committed over history, drawn
  // thin from the previous month's anchor forward.
  const adjPoints = adjValues ? adjValues.map((v, i) => ({ x: toX(i), y: toY(v) })) : null;
  const adjFutPoints = adjPoints ? adjPoints.slice(Math.max(currentMonthIndex - 1, 0)) : [];
  const adjLine = adjFutPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

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

        {/* Below-zero zone: only when the axis actually goes negative */}
        {yMin < 0 && (
          <rect data-testid="negative-zone" x={0} y={toY(0)} width={svgWidth} height={PADDING_TOP + plotHeight - toY(0)} fill={NEGATIVE_ZONE_FILL} />
        )}

        {/* Grid lines (labels are HTML overlays below so they don't distort).
            The £0 line is drawn heavier: it is the line that matters. */}
        {yTicks.map((t, i) => (
          <line
            key={i}
            x1={0} x2={svgWidth} y1={t.y} y2={t.y}
            stroke={t.value === 0 ? 'hsl(var(--muted-foreground))' : 'hsl(var(--border))'}
            strokeWidth={t.value === 0 ? 1.5 : 1}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {/* Area fill */}

        {/* Optimistic band (the visible risk gap) */}
        {hasDivergence && optFutPoints.length > 1 && (
          <path data-testid="optimistic-band" d={bandPath} fill={OPTIMISTIC_BAND_FILL} />
        )}

        {/* Historical line. non-scaling-stroke keeps a true 2px weight despite
            the non-uniform viewBox scaling. */}
        {histPoints.length > 1 && (
          <path d={histLine} fill="none" stroke="hsl(var(--foreground))" strokeWidth={2.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        )}

        {/* Future line (dashed) */}
        {futPoints.length > 1 && (
          <path d={futLine} fill="none" stroke="hsl(var(--foreground))" strokeWidth={2.5} strokeDasharray="7 4" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        )}

        {/* Optimistic line (lighter, dashed) */}
        {hasDivergence && optFutPoints.length > 1 && (
          <path data-testid="optimistic-line" d={optLine} fill="none" stroke={secondaryStroke} strokeWidth={1.5} strokeDasharray="3 3" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        )}

        {/* VAT-adjusted (spendable) line (thin, dotted) */}
        {hasAdjusted && adjFutPoints.length > 1 && (
          <path data-testid="adjusted-line" d={adjLine} fill="none" stroke={adjustedStroke} strokeWidth={2.5} strokeDasharray="0.1 5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        )}

        {/* Tooltip crosshair (the dot is an HTML overlay below) */}
        {tooltip && (
          <line x1={tooltip.x} x2={tooltip.x} y1={PADDING_TOP} y2={PADDING_TOP + plotHeight} stroke="hsl(var(--muted-foreground))" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        )}
      </svg>

      {/* HTML overlays for shapes that must NOT inherit the SVG's non-uniform
          x/y scaling: y-axis labels, the current-month dot, the tooltip dot.
          Positioned by percentage so they track the (uniformly-scaled) axes. */}
      {yTicks.map((t, i) => (
        <div
          key={`ylabel-${i}`}
          className={`absolute text-[11px] pointer-events-none tabular-nums ${t.value === 0 ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}
          style={{ top: `${(t.y / CHART_HEIGHT) * 100}%`, left: AXIS_LABEL_X, transform: 'translateY(-50%)' }}
        >
          {formatGBP(t.value)}
        </div>
      ))}

      <div
        className="absolute rounded-full bg-aubergine pointer-events-none"
        style={{
          width: 12, height: 12,
          left: `${(points[currentMonthIndex].x / svgWidth) * 100}%`,
          top: `${(points[currentMonthIndex].y / CHART_HEIGHT) * 100}%`,
          transform: 'translate(-50%, -50%)',
          boxShadow: '0 0 0 2px hsl(var(--card))',
        }}
      />

      {tooltip && (
        <div
          className="absolute rounded-full bg-aubergine pointer-events-none"
          style={{
            width: 10, height: 10,
            left: `${(tooltip.x / svgWidth) * 100}%`,
            top: `${(tooltip.y / CHART_HEIGHT) * 100}%`,
            transform: 'translate(-50%, -50%)',
            boxShadow: '0 0 0 2px hsl(var(--card)), 0 0 0 4px hsl(var(--sun))',
          }}
        />
      )}

      {/* Legend: only when at least one extra line separates from committed.
          Pinned bottom-left so it stays in view when the grid scrolls. */}
      {(hasDivergence || hasAdjusted) && (
        <div className="absolute bottom-1 left-16 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium text-muted-foreground bg-card/90 rounded-full px-3 py-1 pointer-events-none">
          <span className="flex items-center gap-1.5">
            <LegendSwatch stroke="hsl(var(--aubergine))" />
            {primaryLabel}
          </span>
          {hasDivergence && (
            <span className="flex items-center gap-1.5">
              <LegendSwatch stroke={secondaryStroke} dash="3 2.5" />
              {secondaryLabel}
            </span>
          )}
          {hasAdjusted && (
            <span className="flex items-center gap-1.5">
              <LegendSwatch stroke={adjustedStroke} dash="0.1 4" />
              {adjustedLabel}
            </span>
          )}
        </div>
      )}

      {/* Tooltip popup */}
      {tooltip && (
        <div
          className="absolute pointer-events-none bg-aubergine text-cloud rounded-lg px-2.5 py-1.5 text-xs shadow-lg z-20 whitespace-nowrap"
          style={{
            left: `${(tooltip.x / svgWidth) * 100}%`,
            top: tooltip.y - (Math.abs(tooltip.optimistic - tooltip.value) > 0.005 ? 56 : 40),
            transform: 'translateX(-50%)',
          }}
        >
          <div className="text-muted-on-aubergine">{tooltip.month}</div>
          <div className="font-semibold tabular-nums">{formatGBP(tooltip.value)}</div>
          {Math.abs(tooltip.optimistic - tooltip.value) > 0.005 && (
            <div className="tabular-nums text-muted-on-aubergine">
              {formatGBP(tooltip.optimistic)} · {secondaryLabel}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Legend key drawn as a short line in the series' own dash pattern.
function LegendSwatch({ stroke, dash }: { stroke: string; dash?: string }) {
  return (
    <svg width="16" height="4" aria-hidden="true" className="shrink-0">
      <line x1="1" x2="15" y1="2" y2="2" stroke={stroke} strokeWidth={2.5} strokeLinecap="round" strokeDasharray={dash} />
    </svg>
  );
}

export { COL_WIDTH, CHART_HEIGHT };
