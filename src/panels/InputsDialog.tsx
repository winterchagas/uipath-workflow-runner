import { useState } from 'react'
import { Play } from 'lucide-react'
import { inputType } from '../values.ts'

// Matches the exit animation in App.css (--dur-quick).
const EXIT_MS = 150

type Props = {
  inputs: string[]
  initial: Record<string, string>
  onRun: (raw: Record<string, string>) => void
  /** Called once the exit animation has finished. */
  onClosed: () => void
}

export function InputsDialog({ inputs, initial, onRun, onClosed }: Props) {
  const [raw, setRaw] = useState(() => Object.fromEntries(inputs.map((k) => [k, initial[k] ?? ''])))
  const [closing, setClosing] = useState(false)

  const close = () => {
    if (closing) return
    setClosing(true)
    setTimeout(onClosed, EXIT_MS)
  }

  return (
    <div className={`overlay ${closing ? 'is-closing' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <form
        className="dialog"
        role="dialog"
        aria-label="Run with inputs"
        onSubmit={(e) => {
          e.preventDefault()
          if (closing) return
          onRun(raw)
          close()
        }}
        onKeyDown={(e) => e.key === 'Escape' && close()}
      >
        <h2>Run with inputs</h2>
        <div className="input-rows">
          {inputs.map((k, i) => (
            <label key={k} className="input-row">
              <span className="mono name">{k}</span>
              <input
                className="mono"
                autoFocus={i === 0}
                value={raw[k]}
                onChange={(e) => setRaw({ ...raw, [k]: e.target.value })}
              />
              <span key={inputType(raw[k])} className="type mono swap">
                {inputType(raw[k])}
              </span>
            </label>
          ))}
        </div>
        <p className="muted small">Values are read as JSON when possible, otherwise as text.</p>
        <div className="row end">
          <button type="button" className="ghost" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="primary">
            <Play size={13} fill="currentColor" /> Run
          </button>
        </div>
      </form>
    </div>
  )
}
