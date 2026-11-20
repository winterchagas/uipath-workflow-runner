import { useContext } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Check, X } from 'lucide-react'
import { CanvasState } from './canvasState.ts'
import type { DecisionNode, EndNode, NodeStatus, ScriptNode, StartNode } from './types.ts'

function useNode(id: string, selected: boolean, kind: string) {
  const { status, problems } = useContext(CanvasState)
  const s = status[id] ?? 'idle'
  const className = ['wf-node', `wf-${kind}`, `s-${s}`, selected && 'selected', problems.has(id) && 'has-problem']
    .filter(Boolean)
    .join(' ')
  return { className, status: s }
}

/** Done/failed badge on the shape's corner; the check draws itself in. */
function Badge({ status }: { status: NodeStatus | 'idle' }) {
  if (status === 'done')
    return (
      <span className="badge b-done" aria-label="done">
        <Check size={11} strokeWidth={3} />
      </span>
    )
  if (status === 'failed')
    return (
      <span className="badge b-failed" aria-label="failed">
        <X size={11} strokeWidth={3} />
      </span>
    )
  return null
}

export function StartView({ id, data, selected }: NodeProps<StartNode>) {
  const { className, status } = useNode(id, selected, 'start')
  return (
    <div className={className}>
      <div className="shape">
        <Handle type="source" position={Position.Right} />
        <Badge status={status} />
      </div>
      <div className="label">{data.name}</div>
      {data.inputs.length > 0 && <div className="sub mono">{data.inputs.join(', ')}</div>}
    </div>
  )
}

export function ScriptView({ id, data, selected }: NodeProps<ScriptNode>) {
  const { className, status } = useNode(id, selected, 'script')
  const firstLine = data.code.split('\n').find((l) => l.trim() && !l.trim().startsWith('//')) ?? ''
  return (
    <div className={className}>
      <div className="shape">
        <Handle type="target" position={Position.Left} />
        <span className="preview mono">{firstLine || 'empty script'}</span>
        <Handle type="source" position={Position.Right} />
        <Badge status={status} />
      </div>
      <div className="label">{data.name}</div>
    </div>
  )
}

export function DecisionView({ id, data, selected }: NodeProps<DecisionNode>) {
  const { className, status } = useNode(id, selected, 'decision')
  return (
    <div className={className}>
      <div className="shape">
        <svg viewBox="0 0 72 72" aria-hidden>
          <path d="M70 3 V69 H52 C22 69 3 54 3 36 C3 18 22 3 52 3 Z" />
        </svg>
        <Handle type="target" position={Position.Left} />
        <Handle type="source" id="true" position={Position.Right} className="h-true" />
        <Handle type="source" id="false" position={Position.Right} className="h-false" />
        <span className="branch-label t">true</span>
        <span className="branch-label f">false</span>
        <Badge status={status} />
      </div>
      <div className="label">{data.name}</div>
      <div className="sub mono">{data.expr || 'no expression'}</div>
    </div>
  )
}

export function EndView({ id, data, selected }: NodeProps<EndNode>) {
  const { className, status } = useNode(id, selected, 'end')
  return (
    <div className={className}>
      <div className="shape">
        <Handle type="target" position={Position.Left} />
        <div className="inner" />
        <Badge status={status} />
      </div>
      <div className="label">{data.name}</div>
    </div>
  )
}
