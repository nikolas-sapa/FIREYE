import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '../utils';

export interface ImageComparisonProps {
  before?: string;
  after?: string;
  beforeLabel?: string;
  afterLabel?: string;
  placeholder?: ReactNode;
  className?: string;
}

/** Contained, uncropped images, not an implied pixel-registered wipe. */
export function ImageComparison({
  before, after, beforeLabel = 'Source image', afterLabel = 'Generated hypothesis', placeholder, className,
}: ImageComparisonProps) {
  const [failed, setFailed] = useState<string[]>([]);
  useEffect(() => setFailed([]), [before, after]);
  return (
    <div className={cn('grid gap-px overflow-hidden border border-line bg-line md:grid-cols-2', className)}>
      {[{ src: before, label: beforeLabel }, { src: after, label: afterLabel }].map(({ src, label }, i) => (
        <figure key={i} className="min-w-0 bg-ink-900">
          <figcaption className="flex min-h-10 items-center justify-between gap-3 border-b border-line px-4 py-2 font-mono text-nano uppercase tracking-wider text-bone-dim">
            <span>{label}</span><span className="text-bone-mute">{i === 0 ? 'INPUT' : 'OUTPUT'}</span>
          </figcaption>
          <div className="fcc-sensor flex aspect-[4/3] items-center justify-center bg-void p-2 text-bone">
            {src && !failed.includes(src) ? (
              <img key={src} src={src} alt={label} className="h-full w-full object-contain" referrerPolicy="no-referrer"
                onError={() => setFailed(items => [...items, src])} />
            ) : (
              <div className="max-w-xs px-5 text-center text-sm text-bone-dim" role={src ? 'status' : undefined}>
                {src ? 'Image could not be loaded. Provider links may expire; open the output link or run a new test.' :
                  i === 0 ? 'Choose a test scene or upload an aerial image.' : placeholder ?? 'Your generated review overlay will appear here.'}
              </div>
            )}
          </div>
        </figure>
      ))}
    </div>
  );
}
