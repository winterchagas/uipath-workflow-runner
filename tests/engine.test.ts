import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startRun, type Executor } from '../src/engine/runner.ts'
import { createsCycle, validate } from '../src/engine/validate.ts'
import type { RunState, WFEdge, WFNode } from '../src/types.ts'

// Same contract as the worker, but in-process.
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor
const inProcess: Executor = ({ kind, code, ctx }) => {
  const keys = Object.keys(ctx)
  const fn = new AsyncFunction('ctx', ...keys, kind === 'expr' ? `return (${code}\n)` : code)
  const promise = fn(ctx, ...keys.map((k) => ctx[k])).catch((e: Error) => Promise.reject({ message: e.message }))
  return { promise, cancel: () => {} }
}

const pos = { x: 0, y: 0 }
const start = (inputs: string[]): WFNode => ({ id: 'start', type: 'start', position: pos, data: { name: 'Start', inputs } })
const script = (id: string, code: string): WFNode => ({ id, type: 'script', position: pos, data: { name: id, code, timeoutMs: 5000 } })
const decision = (id: string, expr: string): WFNode => ({ id, type: 'decision', position: pos, data: { name: id, expr } })
const end = (id: string): WFNode => ({ id, type: 'end', position: pos, data: { name: id } })
const edge = (source: string, target: string, sourceHandle?: string): WFEdge => ({
  id: `${source}:${sourceHandle ?? ''}->${target}`,
  source,
  target,
  sourceHandle,
})

function run(nodes: WFNode[], edges: WFEdge[], inputs: Record<string, unknown>): Promise<RunState> {
  return new Promise((resolve) => {
    startRun(nodes, edges, inputs, inProcess, (s) => {
      if (s.status !== 'running') resolve(s)
    })
  })
}

const sleep = (ms: number) => `await new Promise((r) => setTimeout(r, ${ms}));`

// The user's sketch: Start forks to S1 and D; S2 joins S1 + D(true); End joins S2 + D(false).
const sketch = {
  nodes: [start(['a', 'b']), script('S1', 'return { c: a + b }'), decision('D', 'a > b'), script('S2', 'return { d: c * 2 }'), end('End')],
  edges: [edge('start', 'S1'), edge('start', 'D'), edge('S1', 'S2'), edge('D', 'S2', 'true'), edge('D', 'End', 'false'), edge('S2', 'End')],
}

test('sketch graph, decision true: S2 joins once', async () => {
  const s = await run(sketch.nodes, sketch.edges, { a: 5, b: 2 })
  assert.equal(s.status, 'done')
  assert.deepEqual(s.final, { a: 5, b: 2, c: 7, d: 14 })
  assert.equal(s.trace.filter((t) => t.message === 'S2 started').length, 1)
  assert.equal(s.edgeStatus['D:false->End'], 'skipped')
  assert.deepEqual(s.warnings, [])
})

test('sketch graph, decision false: skipped input does not block the join', async () => {
  const s = await run(sketch.nodes, sketch.edges, { a: 1, b: 2 })
  assert.equal(s.status, 'done')
  assert.equal(s.nodeStatus.S2, 'done')
  assert.deepEqual(s.final, { a: 1, b: 2, c: 3, d: 6 })
  assert.deepEqual(s.endsReached, ['End'])
})

test('both branches write the same key: last finished wins, with a warning', async () => {
  const nodes = [start([]), script('slow', `${sleep(40)} return { x: 1 }`), script('fast', `${sleep(5)} return { x: 2 }`), end('End')]
  const edges = [edge('start', 'slow'), edge('start', 'fast'), edge('slow', 'End'), edge('fast', 'End')]
  const s = await run(nodes, edges, {})
  assert.equal(s.final?.x, 1)
  assert.equal(s.warnings.length, 1)
  assert.match(s.warnings[0], /"x".*kept slow's value/)
})

test('one branch updating an inherited key is not a conflict', async () => {
  const nodes = [start(['a']), script('upd', `${sleep(5)} return { a: 10 }`), script('noop', `${sleep(20)}`), end('End')]
  const edges = [edge('start', 'upd'), edge('start', 'noop'), edge('upd', 'End'), edge('noop', 'End')]
  const s = await run(nodes, edges, { a: 1 })
  assert.equal(s.final?.a, 10)
  assert.deepEqual(s.warnings, [])
})

test('skips propagate down untaken paths', async () => {
  const nodes = [start(['n']), decision('D', 'n > 0'), end('Pos'), script('S', 'return {}'), end('Neg')]
  const edges = [edge('start', 'D'), edge('D', 'Pos', 'true'), edge('D', 'S', 'false'), edge('S', 'Neg')]
  const s = await run(nodes, edges, { n: 3 })
  assert.equal(s.nodeStatus.S, 'skipped')
  assert.equal(s.nodeStatus.Neg, 'skipped')
  assert.deepEqual(s.endsReached, ['Pos'])
})

test('a throwing script fails the run', async () => {
  const nodes = [start([]), script('bad', 'throw new Error("boom")'), end('End')]
  const s = await run(nodes, [edge('start', 'bad'), edge('bad', 'End')], {})
  assert.equal(s.status, 'failed')
  assert.equal(s.error?.nodeId, 'bad')
  assert.equal(s.nodeStatus.bad, 'failed')
  assert.equal(s.nodeStatus.End, 'waiting')
})

test('a non-object return fails the run', async () => {
  const nodes = [start([]), script('num', 'return 42'), end('End')]
  const s = await run(nodes, [edge('start', 'num'), edge('num', 'End')], {})
  assert.equal(s.status, 'failed')
  assert.match(s.error!.message, /must return an object/)
})

test('validation catches structural problems', () => {
  const nodes = [start(['a', 'a', '1x']), decision('D', ''), script('orphan', ''), end('End')]
  const msgs = validate(nodes, [edge('start', 'D'), edge('D', 'End', 'true')]).map((p) => p.message)
  for (const expected of ['D: missing false exit', 'D: expression is empty', 'orphan: not reachable from Start', 'orphan: cannot reach any End', 'orphan: has no exit', 'orphan: script is empty', 'Start: input "a" is declared twice', 'Start: input "1x" is not a valid variable name'])
    assert.ok(msgs.includes(expected), `missing: ${expected}\n got: ${msgs.join('\n')}`)
  assert.deepEqual(validate(sketch.nodes, sketch.edges), [])
})

test('cycle detection', () => {
  assert.equal(createsCycle(sketch.edges, 'S2', 'S1'), true)
  assert.equal(createsCycle(sketch.edges, 'S1', 'S1'), true)
  assert.equal(createsCycle(sketch.edges, 'D', 'S1'), false)
})

test('stop cancels running scripts and ends the run as stopped', async () => {
  const nodes = [start([]), script('slow', `${sleep(200)} return { x: 1 }`), end('End')]
  const states: RunState[] = []
  let cancelled = 0
  const exec: Executor = (req) => {
    const task = inProcess(req)
    return { promise: task.promise, cancel: () => cancelled++ }
  }
  const handle = startRun(nodes, [edge('start', 'slow'), edge('slow', 'End')], {}, exec, (s) => states.push(s))
  handle.stop()
  await new Promise((r) => setTimeout(r, 250))
  const last = states.at(-1)!
  assert.equal(last.status, 'stopped')
  assert.equal(last.nodeStatus.slow, 'cancelled')
  assert.equal(last.nodeStatus.End, 'waiting')
  assert.equal(cancelled, 1)
})
