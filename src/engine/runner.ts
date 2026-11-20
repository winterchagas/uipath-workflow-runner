import type { NodeStatus, RunError, RunState, Values, WFEdge, WFNode } from '../types.ts'

/**
 * Execution model
 * - Every edge eventually carries one signal: live (with a context copy) or skipped.
 * - A node activates once all its incoming edges have a signal. If every input was
 *   skipped the node is skipped too and passes the skip on; otherwise the live
 *   contexts are merged and the node runs once.
 * - Each context entry remembers its write version and the versions it replaced, so a
 *   merge can tell "this branch updated the key" from "both branches wrote it". On a
 *   real conflict the later write (higher version = finished last) wins and we warn.
 */

export type ExecRequest = {
  kind: 'script' | 'expr'
  code: string
  ctx: Values
  timeoutMs: number
  onLog: (level: 'log' | 'info' | 'warn' | 'error', text: string) => void
}
export type ExecError = { message: string; line?: number }
export type Executor = (req: ExecRequest) => { promise: Promise<unknown>; cancel: () => void }

type Entry = { value: unknown; ver: number; lineage: number[]; by: string }
type Ctx = Record<string, Entry>
type Signal = { live: true; ctx: Ctx } | { live: false }

const EXPR_TIMEOUT_MS = 5000

export function startRun(
  nodes: WFNode[],
  edges: WFEdge[],
  inputs: Values,
  exec: Executor,
  onUpdate: (state: RunState) => void,
): { stop: () => void } {
  const t0 = performance.now()
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const incoming = new Map<string, WFEdge[]>()
  const outgoing = new Map<string, WFEdge[]>()
  for (const n of nodes) {
    incoming.set(n.id, [])
    outgoing.set(n.id, [])
  }
  for (const e of edges) {
    incoming.get(e.target)?.push(e)
    outgoing.get(e.source)?.push(e)
  }

  let seq = 0
  const signals = new Map<string, Signal>()
  const cancels = new Map<string, () => void>()
  const endContexts: Ctx[] = []
  const name = (id: string) => byId.get(id)?.data.name || id

  const state: RunState = {
    status: 'running',
    startedAt: Date.now(),
    initial: { ...inputs },
    nodeStatus: Object.fromEntries(nodes.map((n) => [n.id, 'waiting' as NodeStatus])),
    edgeStatus: {},
    snapshots: {},
    trace: [],
    logs: [],
    warnings: [],
    endsReached: [],
  }

  let emitQueued = false
  const emit = () => {
    if (emitQueued) return
    emitQueued = true
    queueMicrotask(() => {
      emitQueued = false
      onUpdate({
        ...state,
        nodeStatus: { ...state.nodeStatus },
        edgeStatus: { ...state.edgeStatus },
        snapshots: { ...state.snapshots },
        trace: [...state.trace],
        logs: [...state.logs],
        warnings: [...state.warnings],
        endsReached: [...state.endsReached],
      })
    })
  }
  const trace = (kind: RunState['trace'][number]['kind'], message: string, nodeId?: string) =>
    state.trace.push({ t: Math.round(performance.now() - t0), kind, message, nodeId })
  const setStatus = (id: string, s: NodeStatus) => {
    state.nodeStatus[id] = s
  }

  const merge = (ctxs: Ctx[], where: string): Ctx => {
    const out: Ctx = {}
    for (const c of ctxs) {
      for (const [key, e] of Object.entries(c)) {
        const cur = out[key]
        if (!cur || e.lineage.includes(cur.ver)) out[key] = e
        else if (cur.ver === e.ver || cur.lineage.includes(e.ver)) continue
        else {
          const [win, lose] = e.ver > cur.ver ? [e, cur] : [cur, e]
          if (!sameValue(win.value, lose.value)) {
            const msg =
              `At ${where}: "${key}" was written by ${name(lose.by)} (${show(lose.value)}) and ` +
              `${name(win.by)} (${show(win.value)}); kept ${name(win.by)}'s value (finished last)`
            state.warnings.push(msg)
            trace('warning', msg)
          }
          out[key] = win
        }
      }
    }
    return out
  }

  const send = (edge: WFEdge, signal: Signal) => {
    signals.set(edge.id, signal)
    state.edgeStatus[edge.id] = signal.live ? 'live' : 'skipped'
    const target = byId.get(edge.target)!
    if (incoming.get(target.id)!.every((e) => signals.has(e.id))) activate(target)
  }

  const activate = (node: WFNode) => {
    if (state.status !== 'running') return
    let ctx: Ctx
    if (node.type === 'start') {
      ctx = {}
      for (const [k, v] of Object.entries(inputs)) {
        const ver = ++seq
        ctx[k] = { value: v, ver, lineage: [ver], by: node.id }
      }
    } else {
      const live = incoming
        .get(node.id)!
        .map((e) => signals.get(e.id)!)
        .filter((s): s is Extract<Signal, { live: true }> => s.live)
      if (live.length === 0) {
        setStatus(node.id, 'skipped')
        trace('skipped', `${node.data.name} skipped`, node.id)
        for (const e of outgoing.get(node.id)!) send(e, { live: false })
        return
      }
      ctx = merge(
        live.map((s) => s.ctx),
        node.data.name,
      )
    }
    state.snapshots[node.id] = { before: values(ctx) }
    setStatus(node.id, 'running')
    trace('start', `${node.data.name} started`, node.id)
    emit()

    const finish = (after: Ctx, exits: WFEdge[], skipped: WFEdge[] = []) => {
      state.snapshots[node.id] = { ...state.snapshots[node.id], after: values(after) }
      setStatus(node.id, 'done')
      for (const e of exits) send(e, { live: true, ctx: after })
      for (const e of skipped) send(e, { live: false })
    }

    switch (node.type) {
      case 'start':
        trace('done', `${node.data.name} done`, node.id)
        finish(ctx, outgoing.get(node.id)!)
        break
      case 'end':
        trace('done', `Reached ${node.data.name}`, node.id)
        state.endsReached.push(node.id)
        endContexts.push(ctx)
        finish(ctx, [])
        break
      case 'script':
      case 'decision': {
        const startedAt = performance.now()
        const isScript = node.type === 'script'
        const task = exec({
          kind: isScript ? 'script' : 'expr',
          code: isScript ? node.data.code : node.data.expr,
          ctx: values(ctx),
          timeoutMs: isScript ? node.data.timeoutMs : EXPR_TIMEOUT_MS,
          onLog: (level, text) => {
            state.logs.push({ nodeId: node.id, level, text })
            emit()
          },
        })
        cancels.set(node.id, task.cancel)
        task.promise.then(
          (result) => {
            cancels.delete(node.id)
            if (state.status !== 'running') return
            const ms = Math.round(performance.now() - startedAt)
            if (isScript) {
              if (result !== undefined && (result === null || typeof result !== 'object' || Array.isArray(result))) {
                fail(node.id, { message: `Script must return an object or nothing (got ${show(result)})` })
                return
              }
              const next: Ctx = { ...ctx }
              for (const [k, v] of Object.entries((result ?? {}) as Values)) {
                const ver = ++seq
                next[k] = { value: v, ver, lineage: [...(ctx[k]?.lineage ?? []), ver], by: node.id }
              }
              const changed = Object.keys((result ?? {}) as Values)
              trace('done', `${node.data.name} done in ${ms}ms${changed.length ? ` (set ${changed.join(', ')})` : ''}`, node.id)
              finish(next, outgoing.get(node.id)!)
            } else {
              const branch = Boolean(result)
              const exits = outgoing.get(node.id)!
              trace('decision', `${node.data.name} → ${branch}`, node.id)
              finish(
                ctx,
                exits.filter((e) => e.sourceHandle === String(branch)),
                exits.filter((e) => e.sourceHandle !== String(branch)),
              )
            }
            settle()
          },
          (err: ExecError) => {
            cancels.delete(node.id)
            if (state.status === 'running') fail(node.id, err)
          },
        )
        break
      }
    }
  }

  const halt = (status: RunState['status']) => {
    state.status = status
    state.finishedAt = Date.now()
    for (const [id, cancel] of cancels) {
      cancel()
      setStatus(id, 'cancelled')
      trace('cancelled', `${name(id)} cancelled`, id)
    }
    cancels.clear()
    emit()
  }

  const fail = (nodeId: string, err: ExecError) => {
    const error: RunError = { nodeId, message: err.message, line: err.line }
    state.error = error
    setStatus(nodeId, 'failed')
    trace('failed', `${name(nodeId)} failed: ${err.message}${err.line ? ` (line ${err.line})` : ''}`, nodeId)
    cancels.delete(nodeId)
    halt('failed')
  }

  /** The run is over once nothing is still executing. */
  const settle = () => {
    if (state.status !== 'running') return
    if (cancels.size === 0) {
      state.final = values(merge(endContexts, 'the end'))
      trace('run', `Run finished in ${Math.round(performance.now() - t0)}ms`)
      halt('done')
    } else emit()
  }

  trace('run', 'Run started')
  const start = nodes.find((n) => n.type === 'start')!
  activate(start)
  settle()

  return {
    stop: () => {
      if (state.status !== 'running') return
      trace('run', 'Run stopped')
      halt('stopped')
    },
  }
}

function values(ctx: Ctx): Values {
  return Object.fromEntries(Object.entries(ctx).map(([k, e]) => [k, e.value]))
}

function sameValue(a: unknown, b: unknown): boolean {
  try {
    return a === b || JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

export function show(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(v)
  try {
    return JSON.stringify(v) ?? String(v)
  } catch {
    return String(v)
  }
}
