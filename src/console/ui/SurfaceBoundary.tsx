import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  label: string;
  children: ReactNode;
  className?: string;
}

/** Keeps the console usable if one surface (usually WebGL) fails. */
export class SurfaceBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[fcc] ${this.props.label} failed`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className={this.props.className ?? 'absolute inset-0'}>
        <div className="fcc-dotgrid absolute inset-0 opacity-60" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <span className="font-mono text-nano uppercase tracking-[0.16em] text-amber">{this.props.label} offline</span>
          <span className="max-w-md text-center font-mono text-micro uppercase text-bone-mute">{this.state.error.message}</span>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="mt-2 h-7 border border-line-strong bg-ink-800 px-2.5 font-mono text-micro uppercase tracking-[0.12em] text-bone hover:bg-ink-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }
}
