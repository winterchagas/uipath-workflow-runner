import { Component, type ReactNode } from 'react'
import { clearSaved } from './storage.ts'

/** Last resort if rendering throws: show the error and offer a reset instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="crash">
        <h2>Something went wrong</h2>
        <pre className="mono">{error.message}</pre>
        <p className="muted small">
          Reloading usually fixes it. If it keeps happening, the saved workflow may be broken. Resetting clears it.
        </p>
        <div className="row">
          <button className="primary" onClick={() => location.reload()}>
            Reload
          </button>
          <button
            className="ghost"
            onClick={() => {
              clearSaved()
              location.reload()
            }}
          >
            Reset saved workflow
          </button>
        </div>
      </div>
    )
  }
}
