import { forwardRef, useId, useRef, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../utils';
import { Icon } from '../icons';

const focusRing = 'focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-signal';

/** Arrow / Home / End roving selection shared by Tabs and Segmented. */
function useRoving(values: string[], value: string, onChange: (v: string) => void) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = values.indexOf(value);
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % values.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + values.length) % values.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = values.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const v = values[next];
    if (v !== undefined) onChange(v);
    refs.current[next]?.focus();
  };
  return { refs, onKeyDown };
}

/* ---------------------------------- Tabs ---------------------------------- */

export interface TabsProps {
  items: { id: string; label: string; count?: number }[];
  value: string;
  onChange: (id: string) => void;
  size?: 'sm' | 'md';
  className?: string;
}

export function Tabs({ items, value, onChange, size = 'md', className }: TabsProps) {
  const { refs, onKeyDown } = useRoving(items.map((i) => i.id), value, onChange);
  return (
    <div role="tablist" className={cn('flex items-stretch gap-5 border-b border-line', className)}>
      {items.map((item, i) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.id)}
            onKeyDown={onKeyDown}
            className={cn(
              'relative -mb-px inline-flex items-center gap-1.5 whitespace-nowrap font-mono uppercase tracking-[0.12em] transition-colors duration-quick ease-servo',
              size === 'sm' ? 'h-8 text-micro' : 'h-10 text-nano',
              active ? 'text-bone' : 'text-bone-mute hover:text-bone-dim',
              focusRing,
            )}
          >
            {item.label}
            {item.count !== undefined && (
              <span className={cn('fcc-num text-micro', active ? 'text-signal' : 'text-ink-400')}>
                {String(item.count).padStart(2, '0')}
              </span>
            )}
            <span
              aria-hidden
              className={cn(
                'absolute inset-x-0 bottom-0 h-px origin-left bg-signal transition-transform duration-base ease-servo',
                active ? 'scale-x-100' : 'scale-x-0',
              )}
            />
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------- Segmented ------------------------------- */

export interface SegmentedProps {
  options: { value: string; label: ReactNode }[];
  value: string;
  onChange: (v: string) => void;
  size?: 'sm' | 'md';
  className?: string;
  'aria-label'?: string;
}

export function Segmented({ options, value, onChange, size = 'md', className, ...aria }: SegmentedProps) {
  const { refs, onKeyDown } = useRoving(options.map((o) => o.value), value, onChange);
  return (
    <div role="radiogroup" aria-label={aria['aria-label']} className={cn('inline-flex border border-line-strong bg-ink-900 p-0.5', className)}>
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={onKeyDown}
            className={cn(
              'relative inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-mono uppercase tracking-[0.12em] transition-[background-color,color] duration-quick ease-servo',
              size === 'sm' ? 'h-6 px-2 text-micro' : 'h-7 px-3 text-nano',
              active ? 'bg-ink-700 text-bone' : 'text-bone-mute hover:bg-ink-800 hover:text-bone-dim',
              focusRing,
            )}
          >
            {active && <span aria-hidden className="absolute left-0 top-1/2 h-2.5 w-px -translate-y-1/2 bg-signal" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* --------------------------------- Toggle --------------------------------- */

export interface ToggleProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  size?: 'sm' | 'md';
  disabled?: boolean;
  className?: string;
}

export function Toggle({ checked, onChange, label, size = 'md', disabled, className }: ToggleProps) {
  const md = size === 'md';
  const w = md ? 36 : 28;
  const h = md ? 18 : 14;
  const thumb = h - 6;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn('group/tg inline-flex items-center gap-2.5 text-left disabled:pointer-events-none disabled:opacity-40', focusRing, className)}
    >
      <span
        aria-hidden
        className={cn(
          'relative inline-block shrink-0 border transition-[background-color,border-color] duration-quick ease-servo',
          checked ? 'border-signal bg-signal/15' : 'border-line-strong bg-ink-850 group-hover/tg:border-ink-400',
        )}
        style={{ width: w, height: h }}
      >
        <span className={cn('absolute top-1/2 -translate-y-1/2 font-mono text-[7px] leading-none', checked ? 'left-1 text-signal/70' : 'right-1 text-ink-400')}>
          {checked ? 'I' : 'O'}
        </span>
        <span
          className={cn('absolute top-[2px] transition-[transform,background-color] duration-base ease-snap', checked ? 'bg-signal' : 'bg-ink-300')}
          style={{ width: thumb, height: thumb, left: 2, transform: `translateX(${checked ? w - thumb - 6 : 0}px)` }}
        />
      </span>
      {label != null && (
        <span className={cn('font-mono uppercase tracking-[0.12em]', md ? 'text-nano' : 'text-micro', checked ? 'text-bone' : 'text-bone-dim')}>{label}</span>
      )}
    </button>
  );
}

/* --------------------------------- Slider --------------------------------- */

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  label?: string;
  unit?: string;
  disabled?: boolean;
  className?: string;
}

export function Slider({ value, min, max, step = 1, onChange, label, unit, disabled, className }: SliderProps) {
  const id = useId();
  const span = max - min || 1;
  const pct = Math.min(100, Math.max(0, ((value - min) / span) * 100));
  const decimals = step < 1 ? Math.min(3, String(step).split('.')[1]?.length ?? 1) : 0;
  const ticks = 20;
  return (
    <div className={cn('flex w-full flex-col gap-2', disabled && 'opacity-40', className)}>
      {(label || unit) && (
        <div className="flex items-baseline justify-between gap-3">
          {label && (
            <label htmlFor={id} className="fcc-micro">
              {label}
            </label>
          )}
          <span className="ml-auto font-mono text-tiny text-bone fcc-num">
            {value.toFixed(decimals)}
            {unit && <span className="ml-1 text-bone-mute">{unit}</span>}
          </span>
        </div>
      )}
      <div className="relative h-5">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-valuetext={unit ? `${value.toFixed(decimals)} ${unit}` : undefined}
          onChange={(e) => onChange(Number(e.target.value))}
          className="peer absolute inset-0 z-raised h-full w-full cursor-ew-resize appearance-none bg-transparent opacity-0 disabled:cursor-not-allowed"
        />
        <span aria-hidden className="absolute inset-x-0 top-2 h-px bg-line-strong" />
        <span aria-hidden className="absolute left-0 top-2 h-px bg-signal" style={{ width: `${pct}%` }} />
        <span aria-hidden className="absolute inset-x-0 top-3 flex justify-between">
          {Array.from({ length: ticks + 1 }).map((_, i) => (
            <span
              key={i}
              className={cn('w-px', i % 5 === 0 ? 'h-2' : 'h-1', (i / ticks) * 100 <= pct ? 'bg-signal/70' : 'bg-ink-600')}
            />
          ))}
        </span>
        <span
          aria-hidden
          className="absolute top-0 h-[17px] w-[5px] -translate-x-1/2 border border-ink-950 bg-bone transition-colors duration-quick ease-servo peer-hover:bg-signal-hot peer-focus-visible:bg-signal peer-focus-visible:outline peer-focus-visible:outline-1 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-signal peer-active:bg-signal"
          style={{ left: `${pct}%` }}
        />
      </div>
      <div aria-hidden className="flex justify-between font-mono text-micro text-bone-mute fcc-num">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

/* ---------------------------------- Input --------------------------------- */

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  label?: string;
  hint?: string;
  prefix?: ReactNode;
  suffix?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, prefix, suffix, className, id, disabled, ...rest },
  ref,
) {
  const auto = useId();
  const inputId = id ?? auto;
  const hintId = hint ? `${inputId}-hint` : undefined;
  return (
    <div className={cn('flex w-full flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={inputId} className="fcc-micro">
          {label}
        </label>
      )}
      <div
        className={cn(
          'flex h-9 items-center gap-2 border border-line-strong bg-ink-900 px-2.5 transition-[border-color,background-color] duration-quick ease-servo',
          'hover:border-ink-400 focus-within:border-signal focus-within:bg-ink-850 focus-within:hover:border-signal',
          disabled && 'pointer-events-none opacity-40',
        )}
      >
        {prefix != null && <span className="flex shrink-0 items-center font-mono text-micro uppercase text-bone-mute">{prefix}</span>}
        <input
          ref={ref}
          id={inputId}
          disabled={disabled}
          aria-describedby={hintId}
          className="h-full min-w-0 flex-1 bg-transparent font-mono text-xs text-bone outline-none placeholder:text-ink-500 fcc-num"
          {...rest}
        />
        {suffix != null && <span className="flex shrink-0 items-center font-mono text-micro uppercase text-bone-mute">{suffix}</span>}
      </div>
      {hint && (
        <span id={hintId} className="font-mono text-micro text-bone-mute">
          {hint}
        </span>
      )}
    </div>
  );
});

/* --------------------------------- Select --------------------------------- */

export interface SelectProps {
  label?: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  className?: string;
}

export function Select({ label, options, value, onChange, disabled, className }: SelectProps) {
  const id = useId();
  return (
    <div className={cn('flex w-full flex-col gap-1.5', disabled && 'opacity-40', className)}>
      {label && (
        <label htmlFor={id} className="fcc-micro">
          {label}
        </label>
      )}
      <div className="group/sel relative">
        <select
          id={id}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            'h-9 w-full cursor-pointer appearance-none rounded-none border border-line-strong bg-ink-900 pl-2.5 pr-8 font-mono text-xs uppercase tracking-[0.06em] text-bone',
            'transition-[border-color] duration-quick ease-servo hover:border-ink-400 focus:border-signal focus:outline-none focus-visible:outline-none',
          )}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value} className="bg-ink-900 text-bone">
              {o.label}
            </option>
          ))}
        </select>
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 flex w-8 items-center justify-center border-l border-line text-bone-mute">
          <Icon name="chevron-down" size={12} />
        </span>
      </div>
    </div>
  );
}
