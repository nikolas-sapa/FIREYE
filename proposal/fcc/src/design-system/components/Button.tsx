import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../utils';
import { Icon, type IconName } from '../icons';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  kbd?: string;
}

const base =
  'relative inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap border font-mono uppercase tracking-[0.12em] ' +
  'transition-[background-color,border-color,color,transform] duration-quick ease-servo ' +
  'focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-signal ' +
  'active:translate-y-px disabled:pointer-events-none';

const disabledFilled = 'disabled:border-line disabled:bg-ink-850 disabled:text-ink-500';

const variants: Record<ButtonVariant, string> = {
  primary: cn('border-signal bg-signal text-on-signal hover:border-signal-hot hover:bg-signal-hot active:border-signal-deep active:bg-signal-deep', disabledFilled),
  secondary: cn('border-line-strong bg-ink-800 text-bone hover:border-ink-400 hover:bg-ink-700 active:bg-ink-850', disabledFilled),
  ghost: 'border-transparent bg-transparent text-bone-dim hover:bg-ink-800 hover:text-bone active:bg-ink-850 disabled:text-ink-500',
  danger: cn('border-ember/50 bg-ember/10 text-ember hover:border-ember hover:bg-ember/20 active:bg-ember/30', disabledFilled),
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-7 gap-1.5 px-2.5 text-micro',
  md: 'h-9 gap-2 px-3.5 text-nano',
  lg: 'h-11 gap-2.5 px-5 text-tiny',
};
const iconPx: Record<ButtonSize, number> = { sm: 12, md: 14, lg: 16 };

function Spinner({ size }: { size: number }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 animate-spin border border-current border-r-transparent"
      style={{ width: size - 3, height: size - 3 }}
    />
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, iconRight, loading = false, kbd, className, children, type = 'button', onClick, disabled, ...rest },
  ref,
) {
  const px = iconPx[size];
  const lead: ReactNode = loading ? (
    <Spinner size={px} />
  ) : icon ? (
    <Icon name={icon} size={px} />
  ) : variant === 'primary' ? (
    <span aria-hidden className="h-1 w-1 shrink-0 bg-current" />
  ) : null;
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      aria-busy={loading || undefined}
      onClick={loading ? undefined : onClick}
      className={cn(base, variants[variant], sizes[size], loading && 'cursor-wait', className)}
      {...rest}
    >
      {lead}
      {children != null && <span className="leading-none">{children}</span>}
      {iconRight && !loading && <Icon name={iconRight} size={px} />}
      {kbd && (
        <span
          className={cn(
            'ml-1 inline-flex h-4 min-w-4 items-center justify-center border px-1 text-micro leading-none tracking-normal',
            variant === 'primary' ? 'border-on-signal/30 text-on-signal/70' : 'border-line-strong text-bone-mute',
          )}
        >
          {kbd}
        </span>
      )}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  variant?: 'secondary' | 'ghost';
  size?: 'sm' | 'md';
  active?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, variant = 'secondary', size = 'md', active, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={active === undefined ? undefined : active}
      className={cn(
        'inline-flex shrink-0 items-center justify-center border transition-[background-color,border-color,color] duration-quick ease-servo',
        'focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-signal active:translate-y-px',
        'disabled:pointer-events-none disabled:text-ink-500',
        size === 'sm' ? 'h-7 w-7' : 'h-9 w-9',
        active
          ? 'border-signal/60 bg-signal/10 text-signal'
          : variant === 'ghost'
            ? 'border-transparent text-bone-dim hover:bg-ink-800 hover:text-bone'
            : 'border-line-strong bg-ink-800 text-bone-dim hover:border-ink-400 hover:bg-ink-700 hover:text-bone',
        className,
      )}
      {...rest}
    >
      <Icon name={icon} size={size === 'sm' ? 14 : 16} />
    </button>
  );
});

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center border border-b-2 border-line-strong bg-ink-850 px-1 font-mono text-micro leading-none text-bone-dim',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
