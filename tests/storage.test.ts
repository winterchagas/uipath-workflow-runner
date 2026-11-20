import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, serialize } from '../src/storage.ts'

const example = JSON.parse(readFileSync(new URL('../examples/sketch.json', import.meta.url), 'utf8'))

test('the bundled example parses and round-trips', () => {
  const wf = parse(example)
  assert.equal(wf.nodes.length, 5)
  assert.equal(wf.edges.length, 6)
  assert.deepEqual(parse(serialize(wf)), wf)
})

test('rejects files that are not workflows', () => {
  assert.throws(() => parse(null), /Not a workflow/)
  assert.throws(() => parse({ nodes: [] }), /Not a workflow/)
  assert.throws(() => parse({ nodes: [], edges: [] }), /exactly one Start/)
})

test('repairs or drops malformed entries instead of crashing later', () => {
  const wf = parse({
    nodes: [
      { id: 'start', type: 'start', data: { inputs: ['a', 7] } },
      { id: 's', type: 'script', position: { x: '10' }, data: {} },
      { id: 's', type: 'script', data: { code: 'dup' } },
      { id: 'x', type: 'mystery', data: {} },
      { type: 'end', data: {} },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 's' },
      { id: 'e1', source: 'start', target: 's' },
      { id: 'e2', source: 'start', target: 'gone' },
      { source: 'start', target: 's' },
    ],
    lastInputs: { a: '1', b: 2 },
  })
  assert.deepEqual(wf.nodes.map((n) => n.id), ['start', 's'])
  assert.deepEqual(wf.nodes[0].data, { name: 'start', inputs: ['a'] })
  assert.deepEqual(wf.nodes[1].data, { name: 'script', code: '', timeoutMs: 5000 })
  assert.deepEqual(wf.nodes[1].position, { x: 10, y: 0 })
  assert.deepEqual(wf.edges.map((e) => e.id), ['e1'])
  assert.deepEqual(wf.lastInputs, { a: '1' })
})
