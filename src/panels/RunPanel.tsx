import { useLayoutEffect, useRef, useState } from 'react'
import { Ban, Check, CircleSlash, CircleX, Flag, Play, Split, TriangleExclamationPoint, type LucideIcon } from 'lucide-react'
import type { Problem, RunState, TraceEntry, WFNode } from '../types.ts'
import { ValuesTable } from './ValuesTable.tsx'

export type Tab = 'output' | 'trace'

type Props = {
  tab: Tab
  onTab: (t: Tab) => void
  run: RunState | null
  problems: Problem[]
  nodes: WFNode[]
  onSelect: (id: string) => void
  onClear: () => void
}

const ICON: Record<TraceEntry['kind'], LucideIcon> = {
  run: Flag,
  start: Play,
  done: Check,
  decision: Split,
  skipped: Ban,
  failed: CircleX,
  cancelled: CircleSlash,
  warning: TriangleExclamationPoint,
}

export function RunPanel({ tab, onTab, run, problems, nodes, onSelect, onClear }: Props) {
  const name = (id: string) => nodes.find((n) => n.id === id)?.data.name ?? id
  return (
    <div className="run-panel">
      <Tabs tab={tab} onTab={onTab} count={run?.trace.length} />
      <div className="tab-body">
        {problems.length > 0 && (
          <div className="box error rise">
            <b>Can't run. Fix these first:</b>
            <ul>
              {problems.map((p, i) => (
                <li key={i}>
                  {p.nodeId ? (
                    <button className="link" onClick={() => onSelect(p.nodeId!)}>
                      {p.message}
                    </button>
                  ) : (
                    p.message
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {!run && problems.length === 0 && <p className="muted small empty">Press Run to execute the workflow.</p>}
        {run && tab === 'output' && <Output run={run} name={name} onSelect={onSelect} />}
        {run && tab === 'trace' && <Trace key={run.startedAt} run={run} onSelect={onSelect} onClear={onClear} />}
      </div>
    </div>
  )
}

/** Segmented tabs with a pill that slides to the active tab. */
function Tabs({ tab, onTab, count }: { tab: Tab; onTab: (t: Tab) => void; count?: number }) {
  const barRef = useRef<HTMLDivElement>(null)
  const pillRef = useRef<HTMLSpanElement>(null)
  const placed = useRef(false)

  useLayoutEffect(() => {
    const active = barRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    const pill = pillRef.current
    if (!active || !pill) return
    // Place without animating on first paint, then let later changes slide.
    if (!placed.current) pill.style.transition = 'none'
    pill.style.transform = `translateX(${active.offsetLeft}px)`
    pill.style.width = `${active.offsetWidth}px`
    if (!placed.current) {
      void pill.offsetWidth
      pill.style.transition = ''
      placed.current = true
    }
  }, [tab, count])

  return (
    <div className="tabs-wrap">
      <div className="tabs" role="tablist" ref={barRef}>
        <span className="tab-pill" ref={pillRef} />
        <button role="tab" aria-selected={tab === 'output'} onClick={() => onTab('output')}>
          Output
        </button>
        <button role="tab" aria-selected={tab === 'trace'} onClick={() => onTab('trace')}>
          Trace {count ? <span className="count mono">{count}</span> : null}
        </button>
      </div>
    </div>
  )
}

function Trace({ run, onSelect, onClear }: { run: RunState; onSelect: (id: string) => void; onClear: () => void }) {
  // Entries present when the tab opens rise in a stagger; later ones rise as they stream in.
  const [initialCount] = useState(run.trace.length)
  return (
    <>
      <ol className="trace">
        {run.trace.map((t, i) => {
          const Icon = ICON[t.kind]
          return (
            <li
              key={i}
              className={`rise k-${t.kind} ${t.nodeId ? 'clickable' : ''}`}
              style={{ animationDelay: i < initialCount ? `${Math.min(i, 12) * 30}ms` : '0ms' }}
              onClick={() => t.nodeId && onSelect(t.nodeId)}
            >
              <span className="t mono">+{t.t}ms</span>
              <Icon size={13} className="icon" />
              <span>{t.message}</span>
            </li>
          )
        })}
      </ol>
      {run.status !== 'running' && (
        <button className="ghost small" onClick={onClear}>
          Clear run
        </button>
      )}
    </>
  )
}

function Output({ run, name, onSelect }: { run: RunState; name: (id: string) => string; onSelect: (id: string) => void }) {
  const took = run.finishedAt ? `${run.finishedAt - run.startedAt}ms` : ''
  return (
    <>
      <div className={`status st-${run.status}`}>
        <span className="dot" />
        <span key={run.status} className="swap">
          {{ running: 'Running…', done: `Finished in ${took}`, failed: `Failed after ${took}`, stopped: 'Stopped' }[run.status]}
        </span>
      </div>
      {run.error && (
        <div className="box error rise">
          <button className="link" onClick={() => onSelect(run.error!.nodeId)}>
            <b>{name(run.error.nodeId)}</b>
          </button>
          {run.error.line && <span className="muted"> · line {run.error.line}</span>}
          <pre className="mono">{run.error.message}</pre>
        </div>
      )}
      {run.final && (
        <section className="rise">
          <h3>Result</h3>
          <ValuesTable values={run.final} />
          <p className="small muted">Reached: {run.endsReached.map(name).join(', ')}</p>
        </section>
      )}
      {run.warnings.length > 0 && (
        <section className="rise">
          <h3>Warnings</h3>
          {run.warnings.map((w, i) => (
            <div key={i} className="box warn small">
              <TriangleExclamationPoint size={13} className="inline-icon" /> {w}
            </div>
          ))}
        </section>
      )}
      <section className="rise" style={{ animationDelay: '60ms' }}>
        <h3>Logs</h3>
        {run.logs.length === 0 ? (
          <div className="muted small">No console output.</div>
        ) : (
          <div className="logs mono">
            {run.logs.map((l, i) => (
              <div key={i} className={`log l-${l.level}`}>
                <span className="who" onClick={() => onSelect(l.nodeId)}>
                  {name(l.nodeId)}
                </span>
                {l.text}
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  )
}
