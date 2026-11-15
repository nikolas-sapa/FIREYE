import { useEffect, useState } from 'react';
import { AppearanceToggle, Button, Dot, Icon, InstallAppButton, Serial, ThemeToggle, cn, zulu } from '@ds';

export const REV_A_HREF = '/rev-a/index.html';
export const REV_B_HREF = '/rev-b/index.html';
export const REV_C_HREF = '/rev-c/index.html';
export const CONSOLE_HREF = '/console.html';

const LINKS = [
  { id: 'top', index: '01', label: 'Overview' },
  { id: 'architecture', index: '02', label: 'Architecture' },
  { id: 'stack', index: '03', label: 'Stack' },
  { id: 'dashboard', index: '04', label: 'Live Ops' },
  { id: 'image-lab', index: '04B', label: 'Image Lab' },
  { id: 'system', index: '05', label: 'Design System' },
] as const;

type SectionId = (typeof LINKS)[number]['id'];

/** Angular FCC monogram: clipped-corner frame, split "F" strokes, signal apex. */
export function FccMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" className={cn('text-bone', className)}>
      <path d="M1.5 1.5H17L22.5 7V22.5H1.5Z" fill="none" stroke="currentColor" strokeWidth="1" />
      <path d="M6 18V6H15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
      <path d="M6 12H12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
      <path d="M14.5 18L18 11.5L18 18Z" className="fill-signal" />
      <path d="M17 1.5V7H22.5" fill="none" stroke="currentColor" strokeWidth="0.75" opacity="0.5" />
    </svg>
  );
}

function useZulu() {
  const [now, setNow] = useState(() => zulu());
  useEffect(() => {
    const id = window.setInterval(() => setNow(zulu()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function useActiveSection(): SectionId {
  const [active, setActive] = useState<SectionId>('top');
  useEffect(() => {
    const els = LINKS.map((l) => document.getElementById(l.id)).filter((el): el is HTMLElement => !!el);
    if (!els.length || typeof IntersectionObserver === 'undefined') return;
    // A thin band across the upper-middle of the viewport decides which section "owns" the screen.
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(e.target.id as SectionId);
        }
      },
      { rootMargin: '-40% 0px -55% 0px', threshold: 0 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return active;
}

export default function Nav() {
  const clock = useZulu();
  const active = useActiveSection();

  const goConsole = () => window.location.assign(CONSOLE_HREF);

  return (
    <header className="sticky top-0 z-hud border-b border-line bg-ink-950/80 backdrop-blur-md">
      <div className="mx-auto flex min-h-12 max-w-[1440px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6 py-2 lg:px-10">
        <a href="#top" className="group flex items-center gap-3" aria-label="Fire Command Center — back to top">
          <FccMark />
          <span className="hidden font-mono text-nano uppercase text-bone sm:inline">Fire Command Center</span>
          <span className="hidden h-3 w-px bg-line-strong md:inline-block" aria-hidden />
          <span className="hidden font-mono text-micro uppercase text-bone-mute md:inline">FCC-01</span>
        </a>

        <nav aria-label="Sections" className="hidden h-full items-stretch lg:flex">
          {LINKS.map((l) => {
            const on = active === l.id;
            return (
              <a
                key={l.id}
                href={`#${l.id}`}
                aria-current={on ? 'true' : undefined}
                className={cn(
                  'relative flex items-center gap-2 px-3 font-mono xl:px-4 text-nano uppercase transition-colors duration-quick ease-servo',
                  on ? 'text-bone' : 'text-bone-mute hover:text-bone-dim',
                )}
              >
                <span className={cn('fcc-num', on ? 'text-signal' : 'text-ink-500')}>{l.index}</span>
                {l.label}
                <span
                  aria-hidden
                  className={cn(
                    'absolute inset-x-3 -bottom-px xl:inset-x-4 h-px origin-left bg-signal transition-transform duration-base ease-servo',
                    on ? 'scale-x-100' : 'scale-x-0',
                  )}
                />
              </a>
            );
          })}
        </nav>

        <div className="flex flex-wrap items-center gap-2">
          <div className="hidden items-center gap-2 xl:flex">
            <Dot className="bg-phosphor" live size={5} />
            <span className="font-mono text-tiny text-bone fcc-num" aria-label="Zulu time">{clock}</span>
          </div>
          <Serial className="hidden md:inline-flex">Proposal · Rev D</Serial>
          {[
            { href: REV_A_HREF, label: 'Rev A' },
            { href: REV_B_HREF, label: 'Rev B' },
            { href: REV_C_HREF, label: 'Rev C' },
          ].map((r) => (
            <a
              key={r.href}
              href={r.href}
              className="hidden items-center gap-1 font-mono text-micro uppercase text-bone-mute transition-colors duration-quick ease-servo hover:text-bone md:inline-flex"
              title={`Open the archived ${r.label.toUpperCase()} build`}
            >
              {r.label}
              <Icon name="arrow-up-right" size={10} />
            </a>
          ))}
          <ThemeToggle compact className="hidden sm:inline-flex" />
          <AppearanceToggle className="hidden sm:inline-flex" />
          <InstallAppButton />
          <Button variant="primary" size="sm" iconRight="arrow-up-right" onClick={goConsole} title="Open the full-screen console">
            Console
          </Button>
        </div>
      </div>
    </header>
  );
}
