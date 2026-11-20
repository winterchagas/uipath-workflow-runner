import { MarkerType } from '@xyflow/react'
import type { WFEdge, WFNode } from './types.ts'

const KEY = 'workflow-runner:v1'

export type Workflow = { nodes: WFNode[]; edges: WFEdge[]; lastInputs: Record<string, string> }

export const edgeDefaults = { markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: '#6e685f' } }

export function newWorkflow(): Workflow {
  return {
    nodes: [
      { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: { name: 'Start', inputs: [] } },
      { id: newId(), type: 'end', position: { x: 420, y: 0 }, data: { name: 'End' } },
    ],
    edges: [],
    lastInputs: {},
  }
}

export function newId(): string {
  return `n_${crypto.randomUUID().slice(0, 8)}`
}

/** Keep only what defines the workflow, not React Flow's runtime fields. */
export function serialize({ nodes, edges, lastInputs }: Workflow) {
  return {
    version: 1,
    nodes: nodes.map(({ id, type, position, data }) => ({ id, type, position, data })),
    edges: edges.map(({ id, source, target, sourceHandle }) => ({ id, source, target, sourceHandle })),
    lastInputs,
  }
}

type Raw = Record<string, unknown>
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback)

/** Rebuild a node from known fields only, so a hand-edited file can't crash the canvas. */
function parseNode(n: unknown): WFNode | null {
  if (!isObj(n) || typeof n.id !== 'string') return null
  const d = isObj(n.data) ? n.data : {}
  const pos = isObj(n.position) ? n.position : {}
  const base = { id: n.id, position: { x: Number(pos.x) || 0, y: Number(pos.y) || 0 } }
  const name = str(d.name, String(n.type))
  switch (n.type) {
    case 'start': {
      const inputs = Array.isArray(d.inputs) ? d.inputs.filter((i): i is string => typeof i === 'string') : []
      return { ...base, type: 'start', data: { name, inputs } }
    }
    case 'script': {
      const timeoutMs = Number(d.timeoutMs) > 0 ? Number(d.timeoutMs) : 5000
      return { ...base, type: 'script', data: { name, code: str(d.code), timeoutMs } }
    }
    case 'decision':
      return { ...base, type: 'decision', data: { name, expr: str(d.expr) } }
    case 'end':
      return { ...base, type: 'end', data: { name } }
    default:
      return null
  }
}

/** Throws with a readable message if `raw` isn't a workflow. Unknown or broken entries are dropped. */
export function parse(raw: unknown): Workflow {
  if (!isObj(raw) || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) throw new Error('Not a workflow file')

  const nodes: WFNode[] = []
  const ids = new Set<string>()
  for (const n of raw.nodes.map(parseNode)) {
    if (n && !ids.has(n.id)) {
      nodes.push(n)
      ids.add(n.id)
    }
  }
  if (nodes.filter((n) => n.type === 'start').length !== 1) throw new Error('Workflow must have exactly one Start node')

  const edges: WFEdge[] = []
  const edgeIds = new Set<string>()
  for (const e of raw.edges) {
    if (!isObj(e) || typeof e.id !== 'string' || edgeIds.has(e.id)) continue
    const source = str(e.source)
    const target = str(e.target)
    if (!ids.has(source) || !ids.has(target)) continue
    const sourceHandle = typeof e.sourceHandle === 'string' ? e.sourceHandle : undefined
    edges.push({ id: e.id, source, target, sourceHandle, ...edgeDefaults })
    edgeIds.add(e.id)
  }

  const lastInputs: Record<string, string> = {}
  if (isObj(raw.lastInputs)) {
    for (const [k, v] of Object.entries(raw.lastInputs)) if (typeof v === 'string') lastInputs[k] = v
  }
  return { nodes, edges, lastInputs }
}

export function load(): Workflow {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return parse(JSON.parse(raw))
  } catch {
    // Fall through to a fresh canvas.
  }
  return newWorkflow()
}

export function save(wf: Workflow) {
  try {
    localStorage.setItem(KEY, JSON.stringify(serialize(wf)))
  } catch {
    // Storage full or blocked: autosave is best-effort.
  }
}

/** Drop the saved workflow (used by the error screen's reset). */
export function clearSaved() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing to clear.
  }
}

export function download(wf: Workflow) {
  const blob = new Blob([JSON.stringify(serialize(wf), null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'workflow.json'
  a.click()
  // Revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(a.href), 0)
}
