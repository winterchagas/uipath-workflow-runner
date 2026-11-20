import { Suspense, useState } from 'react'
import { CircleDot, Code, Play, Split, Trash, X } from 'lucide-react'
import { CodeEditor } from './lazyCodeEditor.ts'
import type { RunError, WFNode } from '../types.ts'

type Props = {
  node: WFNode
  readOnly: boolean
  error?: RunError
  onChange: (data: Partial<WFNode['data']>) => void
  onDelete: () => void
  onClose: () => void
}

const TYPE = {
  start: { label: 'Start', Icon: Play },
  script: { label: 'Script', Icon: Code },
  decision: { label: 'Decision', Icon: Split },
  end: { label: 'End', Icon: CircleDot },
}

export function NodeEditor({ node, readOnly, error, onChange, onDelete, onClose }: Props) {
  const { label, Icon } = TYPE[node.type]
  return (
    <div className="editor">
      <div className="editor-head">
        <span className="pill">
          <Icon size={12} /> {label}
        </span>
        <button className="ghost icon-btn" onClick={onClose} title="Close (Esc)" aria-label="Close editor">
          <X size={16} />
        </button>
      </div>
      {readOnly && <div className="muted small">Read-only while the workflow runs.</div>}

      <label>
        Name
        <input value={node.data.name} disabled={readOnly} onChange={(e) => onChange({ name: e.target.value })} />
      </label>

      {node.type === 'start' && (
        // Keyed by node so the draft text resets when another Start is loaded.
        <InputsField key={node.id} inputs={node.data.inputs} readOnly={readOnly} onChange={(inputs) => onChange({ inputs })} />
      )}

      {node.type === 'script' && (
        <>
          <label>Code</label>
          <Suspense fallback={<div className="code-placeholder" />}>
            <CodeEditor value={node.data.code} readOnly={readOnly} onChange={(code) => onChange({ code })} />
          </Suspense>
          <p className="muted small hint">
            Context keys are variables (and <code>ctx</code> is the whole context). <code>return {'{ key: value }'}</code> to
            update the context. <code>await</code> and <code>console.log</code> work.
          </p>
          <label>
            Timeout (seconds)
            <input
              type="number"
              min={0.1}
              step={0.5}
              value={node.data.timeoutMs / 1000}
              disabled={readOnly}
              onChange={(e) => onChange({ timeoutMs: Math.max(100, Number(e.target.value) * 1000 || 5000) })}
            />
          </label>
        </>
      )}

      {node.type === 'decision' && (
        <>
          <label>
            Expression
            <input
              className="mono"
              value={node.data.expr}
              placeholder="a > b"
              disabled={readOnly}
              onChange={(e) => onChange({ expr: e.target.value })}
            />
          </label>
          <p className="muted small hint">A truthy result takes the true exit, anything else takes false.</p>
        </>
      )}

      {error && (
        <div className="box error">
          <b>Failed{error.line ? ` at line ${error.line}` : ''}</b>
          <pre className="mono">{error.message}</pre>
        </div>
      )}

      {node.type !== 'start' && (
        <button className="danger" disabled={readOnly} onClick={onDelete}>
          <Trash size={13} /> Delete node
        </button>
      )}
    </div>
  )
}

function InputsField({ inputs, readOnly, onChange }: { inputs: string[]; readOnly: boolean; onChange: (v: string[]) => void }) {
  const [text, setText] = useState(inputs.join(', '))
  return (
    <label>
      Inputs
      <input
        className="mono"
        value={text}
        placeholder="a, b, c"
        disabled={readOnly}
        onChange={(e) => {
          setText(e.target.value)
          onChange(e.target.value.split(/[\s,]+/).filter(Boolean))
        }}
      />
      <span className="muted small">Comma-separated. You'll be asked for their values on Run.</span>
    </label>
  )
}
