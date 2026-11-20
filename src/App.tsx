import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type OnBeforeDelete,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './App.css'
import { CanvasState } from './canvasState.ts'
import { nodeTypes } from './nodeTypes.ts'
import { startRun } from './engine/runner.ts'
import { createsCycle, validate } from './engine/validate.ts'
import { workerExecutor } from './engine/workerExecutor.ts'
import { download, edgeDefaults, load, newId, newWorkflow, parse, save } from './storage.ts'
import { ContextPanel } from './panels/ContextPanel.tsx'
import { RunPanel, type Tab } from './panels/RunPanel.tsx'
import { NodeEditor } from './panels/NodeEditor.tsx'
import { InputsDialog } from './panels/InputsDialog.tsx'
import { preloadCodeEditor } from './panels/lazyCodeEditor.ts'
import { parseInput } from './values.ts'
import type { RunState, WFEdge, WFNode, WFNodeType } from './types.ts'
import { CircleDot, Code, Download, FilePlus, Play, Plus, Split, Square, Upload } from 'lucide-react'

const ADD_ICON = { script: Code, decision: Split, end: CircleDot }
const MARKER_COLOR = { live: '#ece8e1', skipped: '#3a3732', idle: '#6e685f' }

/** Restart a one-shot CSS animation class, even if it's already applied. */
function replay(el: HTMLElement | null, className: string) {
  if (!el) return
  el.classList.remove(className)
  void el.offsetWidth
  el.classList.add(className)
}

const initial = load()

const ADDABLE: { type: Exclude<WFNodeType, 'start'>; label: string }[] = [
  { type: 'script', label: 'Script' },
  { type: 'decision', label: 'Decision' },
  { type: 'end', label: 'End' },
]

function defaultData(type: Exclude<WFNodeType, 'start'>, name: string): WFNode['data'] {
  if (type === 'script') return { name, code: '', timeoutMs: 5000 }
  if (type === 'decision') return { name, expr: '' }
  return { name }
}

function Workbench() {
  const rf = useReactFlow<WFNode, WFEdge>()
  const [nodes, setNodes, onNodesChange] = useNodesState<WFNode>(initial.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<WFEdge>(initial.edges)
  const [lastInputs, setLastInputs] = useState(initial.lastInputs)
  const [run, setRun] = useState<RunState | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showProblems, setShowProblems] = useState(false)
  const [askInputs, setAskInputs] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('output')
  const runner = useRef<{ stop: () => void } | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const runBtnRef = useRef<HTMLButtonElement>(null)

  const running = run?.status === 'running'
  const start = nodes.find((n) => n.type === 'start')
  const selected = nodes.find((n) => n.id === selectedId)
  // Live while shown, so highlights clear as problems get fixed.
  const problems = useMemo(() => (showProblems ? validate(nodes, edges) : []), [showProblems, nodes, edges])

  // The code editor is split out of the main bundle; fetch it once the canvas is up.
  useEffect(() => {
    const t = setTimeout(preloadCodeEditor, 1000)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => save({ nodes, edges, lastInputs }), 300)
    return () => clearTimeout(t)
  }, [nodes, edges, lastInputs])

  // Closing the editor also clears React Flow's own selection highlight.
  const closeEditor = useCallback(() => {
    setSelectedId(null)
    setNodes((ns) => (ns.some((n) => n.selected) ? ns.map((n) => (n.selected ? { ...n, selected: false } : n)) : ns))
  }, [setNodes])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || askInputs) return
      setAddOpen(false)
      closeEditor()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [askInputs, closeEditor])

  const isValidConnection = useCallback(
    (c: Connection | WFEdge) =>
      !createsCycle(edges, c.source, c.target) &&
      !edges.some((e) => e.source === c.source && e.target === c.target && (e.sourceHandle ?? null) === (c.sourceHandle ?? null)),
    [edges],
  )

  const onConnect = useCallback(
    (c: Connection) => setEdges((es) => addEdge({ ...c, ...edgeDefaults, id: `e_${crypto.randomUUID().slice(0, 8)}` }, es)),
    [setEdges],
  )

  const onBeforeDelete: OnBeforeDelete<WFNode, WFEdge> = useCallback(async ({ nodes: ns, edges: es }) => {
    return { nodes: ns.filter((n) => n.type !== 'start'), edges: es }
  }, [])

  const addNode = (type: Exclude<WFNodeType, 'start'>, label: string) => {
    setAddOpen(false)
    const rect = canvasRef.current!.getBoundingClientRect()
    const center = rf.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
    const offset = (nodes.length % 5) * 24
    const taken = new Set(nodes.map((n) => n.data.name))
    let i = nodes.filter((n) => n.type === type).length + 1
    while (taken.has(`${label} ${i}`)) i++
    const node = {
      id: newId(),
      type,
      position: { x: center.x - 60 + offset, y: center.y - 30 + offset },
      data: defaultData(type, `${label} ${i}`),
    } as WFNode
    setNodes((ns) => [...ns, node])
    setSelectedId(node.id)
  }

  const updateData = (id: string, patch: Partial<WFNode['data']>) =>
    setNodes((ns) => ns.map((n) => (n.id === id ? ({ ...n, data: { ...n.data, ...patch } } as WFNode) : n)))

  // The inputs dialog animates out on its own and then reports closed.
  const beginRun = (raw: Record<string, string>) => {
    setLastInputs((prev) => ({ ...prev, ...raw }))
    const inputs = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, parseInput(v)]))
    // Show the trace while running, then the output once it ends.
    setTab('trace')
    runner.current = startRun(nodes, edges, inputs, workerExecutor, (s) => {
      setRun(s)
      if (s.status !== 'running') setTab('output')
    })
  }

  const onRunClick = () => {
    if (running) return runner.current?.stop()
    if (validate(nodes, edges).length > 0) {
      replay(runBtnRef.current, 'is-shaking')
      setShowProblems(true)
      setSelectedId(null)
      setTab('output')
      return
    }
    setShowProblems(false)
    const inputs = start?.type === 'start' ? start.data.inputs : []
    if (inputs.length > 0) setAskInputs(true)
    else beginRun({})
  }

  const replaceWorkflow = (wf: ReturnType<typeof newWorkflow>) => {
    setNodes(wf.nodes)
    setEdges(wf.edges)
    setLastInputs(wf.lastInputs)
    setRun(null)
    setSelectedId(null)
    setShowProblems(false)
    requestAnimationFrame(() => rf.fitView({ padding: '80px', maxZoom: 1.2 }))
  }

  const onImport = async (file: File | undefined) => {
    if (!file) return
    try {
      replaceWorkflow(parse(JSON.parse(await file.text())))
    } catch (err) {
      alert(`Couldn't import ${file.name}: ${err instanceof Error ? err.message : err}`)
    }
  }

  const displayEdges = useMemo(() => {
    if (!run) return edges
    return edges.map((e) => {
      const s = run.edgeStatus[e.id]
      const flowing = s === 'live' && run.nodeStatus[e.target] === 'running'
      return {
        ...e,
        className: flowing ? 'e-flowing' : s ? `e-${s}` : undefined,
        markerEnd: { ...edgeDefaults.markerEnd, color: MARKER_COLOR[s ?? 'idle'] },
      }
    })
  }, [edges, run])

  const canvasState = useMemo(
    () => ({ status: run?.nodeStatus ?? {}, problems: new Set(problems.flatMap((p) => (p.nodeId ? [p.nodeId] : []))) }),
    [run, problems],
  )

  return (
    <div className="app">
      <ContextPanel start={start} lastInputs={lastInputs} run={run} selected={selected} />

      <main className="canvas" ref={canvasRef}>
        <CanvasState.Provider value={canvasState}>
          <ReactFlow<WFNode, WFEdge>
            className="dark"
            nodes={nodes}
            edges={displayEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            onBeforeDelete={onBeforeDelete}
            onNodeClick={(_, n) => setSelectedId(n.id)}
            onPaneClick={() => {
              setSelectedId(null)
              setAddOpen(false)
            }}
            nodesDraggable={!running}
            nodesConnectable={!running}
            edgesReconnectable={false}
            deleteKeyCode={running ? null : ['Backspace', 'Delete']}
            fitView
            fitViewOptions={{ padding: '80px', maxZoom: 1.2 }}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="#2b2925" />
            <Controls showInteractive={false} position="bottom-left" />
            <Panel position="top-right" className="file-actions">
              <button className="ghost small" disabled={running} onClick={() => confirm('Start a new, empty workflow?') && replaceWorkflow(newWorkflow())}>
                <FilePlus size={13} /> New
              </button>
              <button className="ghost small" disabled={running} onClick={() => importRef.current?.click()}>
                <Upload size={13} /> Import
              </button>
              <button className="ghost small" onClick={() => download({ nodes, edges, lastInputs })}>
                <Download size={13} /> Export
              </button>
              <input
                ref={importRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => {
                  onImport(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
            </Panel>
            <Panel position="bottom-center" className="toolbar">
              <button ref={runBtnRef} className={`run ${running ? 'stop' : 'primary'}`} onClick={onRunClick}>
                {/* Keyed so the label swaps with an enter animation. */}
                <span key={running ? 'stop' : 'run'} className="swap">
                  {running ? <Square size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
                  {running ? 'Stop' : 'Run'}
                </span>
              </button>
              <div className="add-wrap">
                <button
                  className={`add ${addOpen ? 'is-active' : ''}`}
                  disabled={running}
                  onClick={() => setAddOpen((o) => !o)}
                  title="Add node"
                  aria-expanded={addOpen}
                >
                  <Plus size={18} />
                </button>
                {/* Always mounted so it can animate closed; hidden from focus when closed. */}
                <div className={`add-menu ${addOpen && !running ? 'is-open' : ''}`} role="menu">
                  {ADDABLE.map((a) => {
                    const Icon = ADD_ICON[a.type]
                    return (
                      <button key={a.type} role="menuitem" onClick={() => addNode(a.type, a.label)}>
                        <Icon size={15} />
                        {a.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            </Panel>
          </ReactFlow>
        </CanvasState.Provider>
      </main>

      <aside className="panel right">
        {selected ? (
          <NodeEditor
            key={selected.id}
            node={selected}
            readOnly={running}
            error={run?.error?.nodeId === selected.id ? run.error : undefined}
            onChange={(patch) => updateData(selected.id, patch)}
            onDelete={() => rf.deleteElements({ nodes: [{ id: selected.id }] }).then(() => setSelectedId(null))}
            onClose={closeEditor}
          />
        ) : (
          <RunPanel
            tab={tab}
            onTab={setTab}
            run={run}
            problems={problems}
            nodes={nodes}
            onSelect={setSelectedId}
            onClear={() => setRun(null)}
          />
        )}
      </aside>

      {askInputs && start?.type === 'start' && (
        <InputsDialog inputs={start.data.inputs} initial={lastInputs} onRun={beginRun} onClosed={() => setAskInputs(false)} />
      )}
    </div>
  )
}

export default function App() {
  return (
    <ReactFlowProvider>
      <Workbench />
    </ReactFlowProvider>
  )
}
