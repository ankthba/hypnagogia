import { Component, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/** Catches render errors (e.g. a data file that deviates from the contract) and shows them instead of a blank page. */
export default class ErrorBoundary extends Component<{ children: ReactNode; label?: string }, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="rounded-lg border-2 border-red-500/70 bg-red-500/10 p-4 text-sm text-red-100">
          <div className="font-semibold">Render error{this.props.label ? ` in ${this.props.label}` : ''}</div>
          <div className="mt-1 mono break-words">{this.state.error.message}</div>
          <div className="mt-1 text-red-200/80">
            The data file likely deviates from web/DATA_CONTRACT.md. Nothing has been substituted.
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
