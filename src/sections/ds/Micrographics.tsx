import { useEffect, useState } from 'react';
import { Brackets, Crosshair, Datum, Dot, Frame, GridBg, Hatch, Icon, RegMark, Rule, Ruler, Serial, cn, fmtLat, fmtLon, iconNames, zulu } from '@ds';
import { GroupTitle, Spec, SubSection } from './Spec';

export function MicrographicsSpec() {
  const [now, setNow] = useState(() => zulu());
  useEffect(() => {
    const t = window.setInterval(() => setNow(zulu()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <SubSection
      id="system-micro"
      index="04.5"
      kicker="Micrographics"
      title="Small marks that carry meaning."
      lede="The primitive layer. Each mark encodes something true: a boundary, a scale, a datum, a revision. Never use one as pure ornament."
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Spec code="<Brackets size={8} />" tag="Boundary">
          <div className="relative h-20 w-32">
            <Brackets size={8} tone="bone" />
            <span className="absolute inset-0 flex items-center justify-center fcc-micro">Target area</span>
          </div>
        </Spec>
        <Spec code='<Frame bracketTone="signal">' tag="Surface">
          <Frame bracketTone="signal" className="flex h-20 w-40 items-center justify-center">
            <span className="fcc-micro text-bone-dim">Selected frame</span>
          </Frame>
        </Spec>
        <Spec code="<Ruler labels step={10} />" tag="Scale" bodyClassName="px-8">
          <div className="w-full pt-3">
            <Ruler ticks={40} major={5} labels step={10} />
          </div>
        </Spec>
        <Spec code="<Crosshair size={32} />" tag="Reticle">
          <Crosshair size={16} />
          <Crosshair size={32} gap={5} className="text-bone-dim" />
          <Crosshair size={48} gap={8} className="text-signal" />
        </Spec>
        <Spec code="<RegMark />" tag="Registration">
          <RegMark size={14} />
          <RegMark size={22} className="text-bone-mute" />
          <RegMark size={30} className="text-bone-dim" />
        </Spec>
        <Spec code='<Hatch tone="signal" />' tag="Fill / state">
          <Hatch className="h-16 w-24 border border-line" />
          <Hatch tone="signal" className="h-16 w-24 border border-signal/40" />
        </Spec>
        <Spec code='<GridBg variant="dots" />' tag="Texture" bodyClassName="flex-nowrap items-stretch gap-0 p-0">
          <div className="relative h-full min-h-[120px] w-1/2 border-r border-line">
            <GridBg variant="dots" />
            <span className="absolute bottom-2 left-2 fcc-micro">dots</span>
          </div>
          <div className="relative h-full min-h-[120px] w-1/2">
            <GridBg variant="lines" />
            <span className="absolute bottom-2 left-2 fcc-micro">lines</span>
          </div>
        </Spec>
        <Spec code="<Serial>" tag="Provenance">
          <div className="flex flex-col items-center gap-2">
            <Serial>FCC-01 / REV A</Serial>
            <Serial>UAS-07 / SN 0042-118</Serial>
            <Serial>MODEL SPREAD-v3.2</Serial>
          </div>
        </Spec>
        <Spec code='<Rule title="Sector 04" />' tag="Divider" bodyClassName="flex-col items-stretch">
          <Rule />
          <Rule title="Sector 04" />
          <Rule title="Forecast +60 min" align="center" />
        </Spec>
        <Spec code="<Dot live />" tag="Liveness">
          <span className="inline-flex items-center gap-2 fcc-micro"><Dot live /> Link</span>
          <span className="inline-flex items-center gap-2 fcc-micro"><Dot className="bg-amber" /> Degraded</span>
          <span className="inline-flex items-center gap-2 fcc-micro"><Dot className="bg-ember" live /> Fire</span>
        </Spec>
        <Spec code="<Datum label value unit />" tag="Readout" bodyClassName="justify-start gap-6 px-6">
          <Datum label="Lat" value={fmtLat(34.18731)} />
          <Datum label="Lon" value={fmtLon(-118.22409)} />
          <Datum label="UTC" value={now} />
        </Spec>
        <Spec code="composed / sheet corner" tag="Assembly" bodyClassName="p-0">
          <div className="relative h-full min-h-[120px] w-full">
            <RegMark className="absolute left-3 top-3" />
            <RegMark className="absolute bottom-3 right-3" />
            <span className="absolute right-3 top-3"><Serial>SHT 04 / 09</Serial></span>
            <span className="absolute bottom-3 left-3 fcc-micro">{now}</span>
            <Crosshair size={28} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-signal" />
          </div>
        </Spec>
      </div>
    </SubSection>
  );
}

export function IconSpec() {
  const [focus, setFocus] = useState<(typeof iconNames)[number]>('flame');
  return (
    <SubSection
      id="system-icons"
      index="04.6"
      kicker="Iconography"
      title={`${iconNames.length} glyphs on one 24-unit grid.`}
      lede="Drawn for FCC. 1.25 stroke, square caps, miter joins, 2-unit live margin. Straight segments and 45 degree diagonals; curves only where the object is round."
      aside={
        <div className="mt-2 flex flex-col gap-1 border border-line p-3 font-mono text-micro uppercase text-bone-mute">
          <span>Grid 24 x 24</span>
          <span>Stroke 1.25 / 1.5 at 12px</span>
          <span>Cap square / Join miter</span>
          <span>Color currentColor</span>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[320px_1fr]">
        <div className="relative flex flex-col border border-line bg-ink-900">
          <Brackets size={6} />
          <div className="relative m-6 aspect-square">
            <svg aria-hidden viewBox="0 0 24 24" className="absolute inset-0 h-full w-full text-line">
              {Array.from({ length: 25 }).map((_, i) => (
                <g key={i} stroke="currentColor" strokeWidth={0.04}>
                  <line x1={i} y1={0} x2={i} y2={24} />
                  <line x1={0} y1={i} x2={24} y2={i} />
                </g>
              ))}
              <rect x={2} y={2} width={20} height={20} fill="none" stroke="rgb(var(--signal))" strokeWidth={0.06} strokeDasharray="0.4 0.4" />
              <circle cx={12} cy={12} r={10} fill="none" stroke="rgb(var(--ink-500))" strokeWidth={0.05} />
            </svg>
            <Icon name={focus} size={256} strokeWidth={1.25} className="absolute inset-0 h-full w-full text-bone" />
          </div>
          <div className="mt-auto flex items-center justify-between border-t border-line px-3 py-2">
            <code className="font-mono text-micro text-bone-dim">{`<Icon name="${focus}" />`}</code>
            <div className="flex items-center gap-2 text-bone-dim">
              <Icon name={focus} size={12} strokeWidth={1.5} />
              <Icon name={focus} size={16} />
              <Icon name={focus} size={24} />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-px self-start border border-line bg-line sm:grid-cols-5 xl:grid-cols-8">
          {iconNames.map((n) => (
            <button
              key={n}
              type="button"
              onMouseEnter={() => setFocus(n)}
              onFocus={() => setFocus(n)}
              onClick={() => setFocus(n)}
              aria-pressed={focus === n}
              className={cn(
                'group flex aspect-square flex-col items-center justify-center gap-2 bg-ink-950 transition-colors duration-quick ease-servo hover:bg-ink-900',
                focus === n && 'bg-ink-900',
              )}
            >
              <Icon name={n} size={22} className={cn('transition-colors duration-quick ease-servo', focus === n ? 'text-signal' : 'text-bone-dim group-hover:text-bone')} />
              <span className="max-w-full truncate px-1 font-mono text-[8px] uppercase tracking-[0.1em] text-bone-mute">{n}</span>
            </button>
          ))}
        </div>
      </div>
      <GroupTitle code="I.2" className="mt-10">
        Optical sizes
      </GroupTitle>
      <div className="flex flex-wrap items-end gap-8 border border-line bg-ink-900 p-6">
        {[12, 16, 20, 24, 32, 48].map((s) => (
          <div key={s} className="flex flex-col items-center gap-2">
            <Icon name="drone" size={s} strokeWidth={s <= 12 ? 1.5 : 1.25} className="text-ice" />
            <span className="font-mono text-micro text-bone-mute">{s}</span>
          </div>
        ))}
        <span className="ml-auto max-w-xs text-xs text-bone-dim">Use 16 in dense UI, 20 to 24 in unit chips and map markers, 48+ only for construction views.</span>
      </div>
    </SubSection>
  );
}
