import { useEffect, useRef, useState } from 'react';
import { Icon, cn, pad, type IconName } from '@ds';
import { cameraOps } from '../../stage3d/camera-ops';
import type { StageEngine } from '../../stage3d/StageEngine';
import { fireyeUi, useFireye } from './ui';

function Btn({ icon, label, onClick, active, children }: { icon?: IconName; label: string; onClick: () => void; active?: boolean; children?: React.ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} aria-pressed={active} onClick={onClick}
      className={cn('flex h-7 w-7 items-center justify-center font-mono text-micro uppercase transition-colors duration-quick ease-servo',
        'focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-2 focus-visible:outline-signal',
        active ? 'bg-ink-700 text-bone' : 'text-bone-dim hover:bg-ink-800 hover:text-bone')}>
      {icon ? <Icon name={icon} size={12} /> : children}
    </button>
  );
}

const TICKS = Array.from({ length: 36 }, (_, i) => i * 10);

/** Draggable compass ring: drag to rotate the view about its centre, click for north-up, arrows step 15°. */
function CompassRing({ engine }: { engine: StageEngine }) {
  const dial = useRef<SVGGElement>(null);
  const readout = useRef<HTMLSpanElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const drag = useRef<{ a0: number; h0: number; moved: boolean } | null>(null);
  const [hdg, setHdg] = useState(0);
  useEffect(() => {
    let last = -1;
    return engine.onFrame(() => {
      const h = cameraOps.headingDeg(engine);
      if (Math.abs(h - last) < 0.2) return;
      last = h;
      dial.current?.setAttribute('transform', `rotate(${-h} 28 28)`);
      if (readout.current) readout.current.textContent = `${pad(Math.round(h) % 360, 3)}°`;
      setHdg(Math.round(h) % 360);
    });
  }, [engine]);
  const angle = (e: React.PointerEvent) => {
    const r = host.current!.getBoundingClientRect();
    return (Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))) * 180) / Math.PI;
  };
  return (
    <div ref={host} role="slider" tabIndex={0} aria-label="View heading. Drag to rotate, click for north up" aria-valuemin={0} aria-valuemax={359} aria-valuenow={hdg}
      className="relative h-14 w-14 cursor-grab touch-none select-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-signal active:cursor-grabbing"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { a0: angle(e), h0: cameraOps.headingDeg(engine), moved: false }; }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const delta = angle(e) - d.a0;
        if (Math.abs(delta) > 2) d.moved = true;
        if (d.moved) cameraOps.setHeading(engine, d.h0 - delta);
      }}
      onPointerUp={() => { const d = drag.current; drag.current = null; if (d && !d.moved) cameraOps.northUp(engine); }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); cameraOps.setHeading(engine, cameraOps.headingDeg(engine) + (e.key === 'ArrowRight' ? 15 : -15), 0.3); }
        if (e.key === 'Enter' || e.key === 'n' || e.key === 'N') cameraOps.northUp(engine);
      }}>
      <svg viewBox="0 0 56 56" className="absolute inset-0 h-full w-full" aria-hidden>
        <circle cx={28} cy={28} r={27} className="fill-ink-950/90 stroke-line-strong" strokeWidth={1} />
        <g ref={dial}>
          {TICKS.map((d) => (
            <line key={d} x1={28} y1={d % 90 ? 3.5 : 2} x2={28} y2={d % 90 ? 6 : 8} transform={`rotate(${d} 28 28)`}
              className={d === 0 ? 'stroke-bone' : 'stroke-bone-mute'} strokeWidth={d % 90 ? 0.75 : 1.25} />
          ))}
          <text x={28} y={16} textAnchor="middle" className="fill-bone font-mono" fontSize={7}>N</text>
          <path d="M28 18 31 28 28 26 25 28Z" className="fill-bone" />
          <path d="M28 38 31 28 28 30 25 28Z" className="fill-ink-500" />
        </g>
      </svg>
      <span ref={readout} className="fcc-num pointer-events-none absolute inset-x-0 -bottom-3.5 text-center font-mono text-micro text-bone-mute">000°</span>
    </div>
  );
}

function TiltSlider({ engine }: { engine: StageEngine }) {
  const [tilt, setTilt] = useState(50);
  const dragging = useRef(false);
  useEffect(() => {
    let last = -1;
    return engine.onFrame(() => {
      if (dragging.current) return;
      const v = Math.round(Math.max(0, Math.min(80, cameraOps.tiltDeg(engine))));
      if (v !== last) { last = v; setTilt(v); }
    });
  }, [engine]);
  return (
    <label className="flex flex-col items-center gap-1 py-1" title="Tilt">
      <span className="font-mono text-micro uppercase text-bone-mute">Tilt</span>
      <input type="range" min={0} max={80} step={1} value={tilt} aria-label="Camera tilt in degrees from straight down"
        onPointerDown={() => { dragging.current = true; }} onPointerUp={() => { dragging.current = false; }}
        onChange={(e) => { const v = Number(e.target.value); setTilt(v); cameraOps.setTilt(engine, v); }}
        className="h-20 w-3 cursor-pointer accent-bone [direction:rtl] [writing-mode:vertical-lr]" />
      <span className="fcc-num font-mono text-micro text-bone-dim">{pad(tilt, 2)}°</span>
    </label>
  );
}

/** Camera cluster: compass, zoom, tilt, north, home, 2D/3D and orbit around the selection. */
export function CameraControls({ engine, orbitTarget }: { engine: StageEngine; orbitTarget: () => { lon: number; lat: number } | null }) {
  const [top, setTop] = useState(false);
  const orbiting = useFireye((s) => s.orbit);
  const stopRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!orbiting) { stopRef.current?.(); stopRef.current = null; return; }
    const stop = cameraOps.orbit(engine, orbitTarget());
    stopRef.current = () => { stop(); };
    // Any user drag inside the orbit stops it; mirror that in the button state.
    const canvas = engine.viewer.scene.canvas;
    const off = () => fireyeUi.set({ orbit: false });
    canvas.addEventListener('pointerdown', off);
    canvas.addEventListener('wheel', off, { passive: true });
    return () => { canvas.removeEventListener('pointerdown', off); canvas.removeEventListener('wheel', off); stop(); };
  }, [orbiting, engine, orbitTarget]);
  return (
    <div className="fireye-enter flex flex-col items-center gap-2" style={{ ['--i' as string]: 5 }}>
      <CompassRing engine={engine} />
      <div className="mt-3 flex flex-col border border-line-strong bg-ink-950/90">
        <Btn icon="plus" label="Zoom in" onClick={() => cameraOps.zoom(engine, 1)} />
        <span className="h-px bg-line" />
        <Btn icon="minus" label="Zoom out" onClick={() => cameraOps.zoom(engine, -1)} />
      </div>
      <div className="flex flex-col items-center border border-line-strong bg-ink-950/90 px-1">
        <TiltSlider engine={engine} />
      </div>
      <div className="flex flex-col border border-line-strong bg-ink-950/90">
        <Btn label="North up" onClick={() => cameraOps.northUp(engine)}><span className="text-tiny">N</span></Btn>
        <span className="h-px bg-line" />
        <Btn icon="locate" label="Home view (H)" onClick={() => cameraOps.home(engine)} />
        <span className="h-px bg-line" />
        <Btn label={top ? 'Switch to 3D oblique view' : 'Switch to 2D top-down view'} active={top} onClick={() => setTop(cameraOps.toggle2D(engine))}>
          <span className="text-micro">{top ? '3D' : '2D'}</span>
        </Btn>
        <span className="h-px bg-line" />
        <Btn icon="compass" label={orbiting ? 'Stop orbit' : 'Orbit the selection (O)'} active={orbiting} onClick={() => fireyeUi.set({ orbit: !orbiting })} />
      </div>
    </div>
  );
}
