import { useEffect, useId, useRef, useState } from 'react';
import data from '../data/greece-wildfire-fatalities.json';

export function WildfireFatalityChart() {
  const id = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(736);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const measure = () => setWidth(svg.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);
  const titleId = `${id}-title`;
  const descId = `${id}-desc`;
  const slot = 636 / 45;
  const fontSize = Math.max(12, 10 * 736 / Math.max(1, width));
  return (
    <section className="min-w-0 border-b border-line px-4 py-3">
      <h2 className="font-mono text-micro uppercase tracking-[0.14em] text-bone-dim">Greece: recorded wildfire fatalities</h2>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-mono text-micro text-bone-mute">{data.period_start}–{data.period_end}</p>
        <p className="text-xs text-bone-dim"><span className="font-mono text-lg text-bone fcc-num">{data.total_recorded}</span> · Recorded in this source</p>
      </div>
      <svg ref={svgRef} viewBox="0 0 736 190" role="img" aria-labelledby={`${titleId} ${descId}`} className="mt-3 block h-auto w-full min-w-0 font-mono text-bone-mute">
        <title id={titleId}>{`Greece: recorded wildfire fatalities, ${data.period_start}–${data.period_end}`}</title>
        <desc id={descId}>Annual recorded fatalities from EEA / CATDAT. {data.total_recorded} recorded in this source. Historical records, not projected deaths.</desc>
        {[0, 50, 100].map(tick => {
          const y = 148 - tick / 110 * 132;
          return <g key={tick}>
            <line x1={72} x2={708} y1={y} y2={y} stroke="currentColor" strokeOpacity={tick === 0 ? 0.5 : 0.18} />
            <text x={62} y={y + 4} textAnchor="end" fill="currentColor" fontSize={fontSize}>{tick}</text>
          </g>;
        })}
        {data.values.map((row, i) => (
          <rect key={row.year} data-year={row.year} x={72 + i * slot + 2} width={slot - 4} y={148 - row.fatalities / 110 * 132} height={row.fatalities / 110 * 132} className="fill-bone-dim">
            <title>{`${row.year}: ${row.fatalities} recorded fatalities`}</title>
          </rect>
        ))}
        {[1980, 1990, 2000, 2010, 2024].map(year => (
          <text key={year} x={72 + data.values.findIndex(row => row.year === year) * slot + slot / 2} y={173} textAnchor="middle" fill="currentColor" fontSize={fontSize}>{year}</text>
        ))}
      </svg>
      <a href={data.source_page} target="_blank" rel="noopener noreferrer" className="text-xs text-ice underline decoration-ice/30 underline-offset-2 hover:text-bone focus-visible:outline focus-visible:outline-1 focus-visible:outline-signal">EEA / CATDAT by RiskLayer</a>
      <p className="mt-2 text-xs leading-5 text-bone-mute">Historical records, not projected deaths. Source-vintage counts may differ from later revisions; zeros mean none recorded in this series.</p>
    </section>
  );
}
