import type { Problem, WFEdge, WFNode } from '../types.ts'

const IDENT = /^[A-Za-z_$][\w$]*$/
const RESERVED = new Set(
  ('break case catch class const continue debugger default delete do else enum export extends false finally ' +
    'for function if import in instanceof new null return super switch this throw true try typeof var void ' +
    'while with yield let static implements interface package private protected public await arguments eval ctx')
    .split(' '),
)

/** Usable as a script variable: a valid identifier that isn't reserved (`ctx` is the whole-context object). */
export function isUsableName(key: string): boolean {
  return IDENT.test(key) && !RESERVED.has(key)
}

/** Would adding source → target close a loop (or be a self-loop)? */
export function createsCycle(edges: WFEdge[], source: string, target: string): boolean {
  if (source === target) return true
  const out = adjacency(edges)
  const seen = new Set<string>()
  const stack = [target]
  while (stack.length) {
    const id = stack.pop()!
    if (id === source) return true
    if (seen.has(id)) continue
    seen.add(id)
    stack.push(...(out.get(id) ?? []))
  }
  return false
}

export function validate(nodes: WFNode[], edges: WFEdge[]): Problem[] {
  const problems: Problem[] = []
  const ids = new Set(nodes.map((n) => n.id))
  const live = edges.filter((e) => ids.has(e.source) && ids.has(e.target))
  const out = adjacency(live)
  const into = adjacency(live.map((e) => ({ ...e, source: e.target, target: e.source })))

  const starts = nodes.filter((n) => n.type === 'start')
  if (starts.length !== 1) problems.push({ message: `Workflow needs exactly one Start node (found ${starts.length})` })
  const ends = nodes.filter((n) => n.type === 'end')
  if (ends.length === 0) problems.push({ message: 'Workflow has no End node' })

  if (hasCycle(nodes, out)) problems.push({ message: 'Workflow contains a loop' })

  const fromStart = reach(starts.map((n) => n.id), out)
  const toEnd = reach(ends.map((n) => n.id), into)

  for (const n of nodes) {
    const name = n.data.name || n.type
    const add = (message: string) => problems.push({ nodeId: n.id, message: `${name}: ${message}` })
    const outgoing = live.filter((e) => e.source === n.id)

    if (n.type !== 'start' && !fromStart.has(n.id)) add('not reachable from Start')
    if (n.type !== 'end' && !toEnd.has(n.id)) add('cannot reach any End')

    switch (n.type) {
      case 'start': {
        if (outgoing.length === 0) add('has no exit')
        const seen = new Set<string>()
        for (const input of n.data.inputs) {
          if (!isUsableName(input)) add(`input "${input}" is not a valid variable name`)
          if (seen.has(input)) add(`input "${input}" is declared twice`)
          seen.add(input)
        }
        break
      }
      case 'script':
        if (outgoing.length === 0) add('has no exit')
        if (!n.data.code.trim()) add('script is empty')
        break
      case 'decision':
        if (!outgoing.some((e) => e.sourceHandle === 'true')) add('missing true exit')
        if (!outgoing.some((e) => e.sourceHandle === 'false')) add('missing false exit')
        if (!n.data.expr.trim()) add('expression is empty')
        break
    }
  }
  return problems
}

function adjacency(edges: { source: string; target: string }[]): Map<string, string[]> {
  const m = new Map<string, string[]>()
  for (const e of edges) m.set(e.source, [...(m.get(e.source) ?? []), e.target])
  return m
}

function reach(roots: string[], adj: Map<string, string[]>): Set<string> {
  const seen = new Set<string>()
  const stack = [...roots]
  while (stack.length) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    stack.push(...(adj.get(id) ?? []))
  }
  return seen
}

function hasCycle(nodes: WFNode[], out: Map<string, string[]>): boolean {
  const state = new Map<string, 'visiting' | 'done'>()
  const visit = (id: string): boolean => {
    if (state.get(id) === 'done') return false
    if (state.get(id) === 'visiting') return true
    state.set(id, 'visiting')
    for (const next of out.get(id) ?? []) if (visit(next)) return true
    state.set(id, 'done')
    return false
  }
  return nodes.some((n) => visit(n.id))
}
