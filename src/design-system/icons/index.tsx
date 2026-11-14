import type { ReactElement, SVGProps } from 'react';
import { cn } from '../utils';

/* ---------------------------------------------------------------------------
 * FCC/IC — operational icon set.
 * 24 x 24 grid, 2px live margin, 1.25 stroke, square caps, miter joins.
 * Geometry favours straight segments and 45deg diagonals; curves only where
 * the object is physically round (rotors, wheels, lenses).
 * ------------------------------------------------------------------------- */

export type IconName =
  | 'drone' | 'engine' | 'crew' | 'helo' | 'tanker' | 'dozer'
  | 'flame' | 'wind' | 'droplet' | 'thermometer' | 'hazard' | 'human' | 'structure' | 'tree'
  | 'video' | 'image' | 'news' | 'sensor' | 'radio' | 'satellite' | 'ai'
  | 'target' | 'layers' | 'play' | 'pause' | 'plus' | 'minus' | 'close' | 'check'
  | 'chevron-right' | 'chevron-down' | 'chevron-left' | 'arrow-up-right' | 'arrow-right'
  | 'locate' | 'compass' | 'eye' | 'clock' | 'signal' | 'battery' | 'route' | 'shield'
  | 'alert' | 'search' | 'settings' | 'grid' | 'expand' | 'filter' | 'zap' | 'map';

const glyphs: Record<IconName, ReactElement> = {
  drone: (
    <>
      <rect x="9.5" y="9.5" width="5" height="5" />
      <path d="M9.5 9.5 7 7M14.5 9.5 17 7M9.5 14.5 7 17M14.5 14.5 17 17" />
      <circle cx="5" cy="5" r="2.75" />
      <circle cx="19" cy="5" r="2.75" />
      <circle cx="5" cy="19" r="2.75" />
      <circle cx="19" cy="19" r="2.75" />
    </>
  ),
  engine: (
    <>
      <path d="M2 16.5V9h11.5v7.5M13.5 11.5h4.5l3 3.5v1.5" />
      <path d="M2 16.5h2.5M8.5 16.5h6.5M19 16.5h2" />
      <circle cx="6.5" cy="17" r="2" />
      <circle cx="17" cy="17" r="2" />
      <path d="M3 6h9.5M4.5 6v3M7.75 6v3M11 6v3" />
    </>
  ),
  crew: (
    <>
      <path d="M8.5 8V6.5a3.5 3.5 0 0 1 7 0V8" />
      <path d="M6.5 8h11" />
      <path d="M9 8.5v1a3 3 0 0 0 6 0v-1" />
      <path d="M4.5 21v-4l3-3.5h9l3 3.5v4" />
      <path d="M12 13.5V21" />
    </>
  ),
  helo: (
    <>
      <path d="M3 4.5h18M12 4.5V8" />
      <path d="M5 8h9l3.5 4v3.5H5z" />
      <path d="M17.5 12H22M22 10v4" />
      <path d="M5 11.5h5.5" />
      <path d="M8 15.5v3.5M14.5 15.5v3.5M5 19h12" />
    </>
  ),
  tanker: (
    <>
      <path d="M12 2.5V21" />
      <path d="M2.5 12 12 9l9.5 3v1.75L12 12.5l-9.5 1.25z" />
      <path d="M8.5 20.5 12 19l3.5 1.5" />
      <path d="M10.5 4.5h3" />
    </>
  ),
  dozer: (
    <>
      <path d="M4 14V8.5h6.5l2 3H17V14" />
      <path d="M6.5 8.5V6h3" />
      <rect x="3" y="14" width="15" height="5" />
      <path d="M5.5 16.5h0M10.5 16.5h0M15.5 16.5h0" />
      <path d="M21 8.5V19M18 12.5h3" />
    </>
  ),
  flame: (
    <>
      <path d="M12 2.5 16 8l1.25-2.5L20 11c0 5.75-3.5 10.5-8 10.5S4 16.75 4 11l3.75-5.5L9 9z" />
      <path d="M12 21.5c-1.9 0-3.25-1.5-3.25-3.5L12 13l3.25 5c0 2-1.35 3.5-3.25 3.5z" />
    </>
  ),
  wind: (
    <>
      <path d="M2.5 8.5H14a2.75 2.75 0 1 0-2.75-2.75" />
      <path d="M2.5 12.5h16.25a2.75 2.75 0 1 1-2.75 2.75" />
      <path d="M2.5 16.5h7.5" />
    </>
  ),
  droplet: (
    <>
      <path d="M12 2.5 18 11.75a6.25 6.25 0 1 1-12 0z" />
      <path d="M9 15.5a3 3 0 0 0 2.5 2.75" />
    </>
  ),
  thermometer: (
    <>
      <path d="M9.75 4.25a2.25 2.25 0 0 1 4.5 0V14a4.25 4.25 0 1 1-4.5 0z" />
      <path d="M12 9v8.5" />
      <path d="M17 5h2.5M17 8h1.5M17 11h2.5" />
    </>
  ),
  hazard: (
    <>
      <path d="M12 2.75 22 20.5H2z" />
      <path d="M12 9.5v5.5M12 17.25v1" />
    </>
  ),
  human: (
    <>
      <rect x="10" y="2.5" width="4" height="4" />
      <path d="M6.5 12 12 9l5.5 3" />
      <path d="M12 9v6.5" />
      <path d="M8.5 21.5 12 15.5l3.5 6" />
    </>
  ),
  structure: (
    <>
      <path d="M1.5 21h21" />
      <path d="M3.5 21V10l8.5-6 8.5 6v11" />
      <path d="M10 21v-6h4v6" />
      <path d="M16 7.25V3.5h2.5v5.5" />
    </>
  ),
  tree: (
    <>
      <path d="M12 2.5 17.5 10h-3L19.5 17h-15l5-7h-3z" />
      <path d="M12 17v4.5M9 21.5h6" />
    </>
  ),
  video: (
    <>
      <rect x="2.5" y="6" width="13" height="12" />
      <path d="M15.5 10.25 21.5 7v10l-6-3.25" />
      <path d="M5.5 9h1.5" />
    </>
  ),
  image: (
    <>
      <rect x="2.5" y="4" width="19" height="16" />
      <path d="m2.5 16.5 5.5-5.5 4.5 4.5 3-3 6 6" />
      <rect x="15" y="7.5" width="2.5" height="2.5" />
    </>
  ),
  news: (
    <>
      <path d="M3 4h13.5v16H3z" />
      <path d="M16.5 8.5H21V20h-4.5" />
      <path d="M6 7.5h7.5M6 11h7.5M6 14h7.5M6 17h4.5" />
    </>
  ),
  sensor: (
    <>
      <rect x="10.75" y="10.75" width="2.5" height="2.5" />
      <path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8" />
    </>
  ),
  radio: (
    <>
      <rect x="7" y="7.5" width="10" height="14" />
      <path d="M9.5 7.5V2.5" />
      <path d="M9.5 11h5M9.5 13.5h5M9.5 16h5" />
      <path d="M9.5 19h1.5" />
    </>
  ),
  satellite: (
    <>
      <rect x="9.5" y="9.5" width="5" height="5" />
      <path d="M2 8.5h5.5v7H2zM16.5 8.5H22v7h-5.5z" />
      <path d="M4.75 8.5v7M19.25 8.5v7M7.5 12h2M14.5 12h2" />
      <path d="M12 9.5V5.5M9.75 3.5h4.5" />
      <path d="M12 14.5v3" />
    </>
  ),
  ai: (
    <>
      <rect x="6" y="6" width="12" height="12" />
      <path d="M9.5 2.5V6M14.5 2.5V6M9.5 18v3.5M14.5 18v3.5M2.5 9.5H6M2.5 14.5H6M18 9.5h3.5M18 14.5h3.5" />
      <path d="M12 9 15 12l-3 3-3-3z" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 1.5v4.5M12 18v4.5M1.5 12H6M18 12h4.5" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3 21.5 8 12 13 2.5 8z" />
      <path d="M2.5 12 12 17l9.5-5" />
      <path d="M2.5 16 12 21l9.5-5" />
    </>
  ),
  play: <path d="M7 4.5v15L19.5 12z" />,
  pause: <path d="M8.5 5v14M15.5 5v14" />,
  plus: <path d="M12 4.5v15M4.5 12h15" />,
  minus: <path d="M4.5 12h15" />,
  close: <path d="m5.5 5.5 13 13M18.5 5.5l-13 13" />,
  check: <path d="m4.5 12.5 5 5 10-11" />,
  'chevron-right': <path d="m9 5.5 6.5 6.5L9 18.5" />,
  'chevron-down': <path d="M5.5 9 12 15.5 18.5 9" />,
  'chevron-left': <path d="M15 5.5 8.5 12l6.5 6.5" />,
  'arrow-up-right': <path d="M6.5 17.5 17.5 6.5M8.5 6.5h9v9" />,
  'arrow-right': <path d="M3 12h17.5M13.5 5l7 7-7 7" />,
  locate: (
    <>
      <circle cx="12" cy="12" r="6.5" />
      <path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4" />
      <rect x="11" y="11" width="2" height="2" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 5 15 12l-3 7-3-7z" />
      <path d="M9 12h6" />
    </>
  ),
  eye: (
    <>
      <path d="M1.5 12 6 6.5h12l4.5 5.5L18 17.5H6z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 6v6l4 2.5" />
      <path d="M12 2.5v1.5M21.5 12H20M12 21.5V20M2.5 12H4" />
    </>
  ),
  signal: <path d="M4 20.5V17M9 20.5V13M14 20.5V9M19 20.5V4.5" />,
  battery: (
    <>
      <rect x="2" y="7" width="17" height="10" />
      <path d="M21.5 10v4" />
      <path d="M5 10v4M8 10v4M11 10v4" />
    </>
  ),
  route: (
    <>
      <rect x="2.5" y="17.5" width="4" height="4" />
      <rect x="17.5" y="2.5" width="4" height="4" />
      <path d="M6.5 19.5h11v-7.5h-11V4.5h11" strokeDasharray="2 2" />
    </>
  ),
  shield: (
    <>
      <path d="M12 2.5 20 5.5v6.5c0 4.75-3.25 8-8 9.5-4.75-1.5-8-4.75-8-9.5V5.5z" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </>
  ),
  alert: (
    <>
      <path d="M8 2.5h8l5.5 5.5v8L16 21.5H8L2.5 16V8z" />
      <path d="M12 7v6.5M12 16v1.25" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.25 15.25 6.25 6.25" />
    </>
  ),
  settings: (
    <>
      <path d="M12 2.5 20.25 7.25v9.5L12 21.5l-8.25-4.75v-9.5z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" />
    </>
  ),
  expand: <path d="M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6" />,
  filter: <path d="M2.5 4h19L14 12.5v7L10 21.5v-9z" />,
  zap: <path d="M13.5 2 4.5 14h7l-1 8 9-12.5h-7z" />,
  map: (
    <>
      <path d="M2.5 5.5 9 3l6 2.5L21.5 3v15.5L15 21l-6-2.5L2.5 21z" />
      <path d="M9 3v15.5M15 5.5V21" />
    </>
  ),
};

export const iconNames = Object.keys(glyphs) as IconName[];

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  /** Accessible name. When omitted the icon is decorative (aria-hidden). */
  title?: string;
}

export function Icon({ name, size = 16, strokeWidth = 1.25, className, title, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="square"
      strokeLinejoin="miter"
      strokeMiterlimit={10}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
      className={cn('shrink-0', className)}
      {...rest}
    >
      {glyphs[name]}
    </svg>
  );
}
