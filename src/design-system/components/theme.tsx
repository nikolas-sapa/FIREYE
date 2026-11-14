import { THEMES, THEME_IDS, setTheme, useTheme, setAppearance, useAppearance, type Appearance, type ThemeId } from '../tokens';
import { cn } from '../utils';

export interface ThemeToggleProps {
  /** Hides the "Theme" caption; keeps the two segments. */
  compact?: boolean;
  /** Keyboard hint rendered after the segments (e.g. "T" in the console). */
  hint?: string;
  className?: string;
  onChange?: (theme: ThemeId) => void;
}

/** Independent of FCC / Team branding. Auto follows replay daylight in the console. */
export function AppearanceToggle({ className }: { className?: string }) {
  const mode = useAppearance();
  return (
    <label className={cn('inline-flex h-7 shrink-0 items-center gap-1.5 border border-line-strong bg-ink-900 px-2 font-mono text-micro uppercase text-bone-dim', className)}>
      <span className="h-2 w-2 border border-current" aria-hidden />
      <select
        aria-label="Appearance"
        title="Auto follows map daylight in the console, system appearance on the proposal"
        value={mode}
        onChange={(e) => setAppearance(e.target.value as Appearance)}
        className="max-w-[78px] cursor-pointer bg-transparent font-mono text-micro uppercase text-bone focus-visible:outline-signal"
      >
        <option value="auto">Auto · sun</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}

/**
 * Two-segment theme switch (FCC / Team). Each segment carries a swatch of its own accent so the
 * choice is legible before it is made. Persists to localStorage `fcc.theme`.
 */
export function ThemeToggle({ compact = false, hint, className, onChange }: ThemeToggleProps) {
  const theme = useTheme();
  return (
    <div role="group" aria-label="Theme" className={cn('inline-flex h-7 shrink-0 items-stretch border border-line-strong bg-ink-900', className)}>
      {!compact && (
        <span className="flex items-center border-r border-line px-2 font-mono text-micro uppercase text-bone-mute">Theme</span>
      )}
      {THEME_IDS.map((id, i) => {
        const on = theme === id;
        const spec = THEMES[id];
        return (
          <button
            key={id}
            type="button"
            aria-pressed={on}
            title={spec.description}
            onClick={() => {
              setTheme(id);
              onChange?.(id);
            }}
            className={cn(
              'inline-flex items-center gap-1.5 px-2 font-mono text-micro uppercase tracking-[0.12em] transition-colors duration-quick ease-servo',
              'focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-[-3px] focus-visible:outline-signal',
              i > 0 && 'border-l border-line',
              on ? 'bg-ink-700 text-bone' : 'text-bone-mute hover:bg-ink-800 hover:text-bone-dim',
            )}
          >
            {/* Only the active theme shows its accent, so the Team theme never paints an orange swatch. */}
            <span aria-hidden className={cn('h-1.5 w-1.5', on ? 'bg-signal' : 'border border-ink-400')} />
            {spec.label}
          </button>
        );
      })}
      {hint && (
        <span aria-hidden className="flex items-center border-l border-line px-1.5 font-mono text-micro text-ink-500">
          {hint}
        </span>
      )}
    </div>
  );
}
