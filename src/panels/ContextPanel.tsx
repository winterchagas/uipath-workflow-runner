import type { RunState, WFNode } from '../types.ts'
import { changedKeys } from '../values.ts'
import { ValuesTable } from './ValuesTable.tsx'

type Props = {
  start: WFNode | undefined
  lastInputs: Record<string, string>
  run: RunState | null
  selected: WFNode | undefined
}

export function ContextPanel({ start, lastInputs, run, selected }: Props) {
  return (
    <aside className="panel left">
      <h2>Context</h2>
      <Body start={start} lastInputs={lastInputs} run={run} selected={selected} />
    </aside>
  )
}

function Body({ start, lastInputs, run, selected }: Props) {
  if (run && selected) {
    const snap = run.snapshots[selected.id]
    if (!snap)
      return (
        <p className="muted small">
          <b>{selected.data.name}</b> {run.nodeStatus[selected.id] === 'skipped' ? 'was skipped' : "hasn't run"}.
        </p>
      )
    return (
      <>
        <h3>{selected.data.name} · before</h3>
        <ValuesTable values={snap.before} />
        <h3>after</h3>
        {snap.after ? (
          <ValuesTable values={snap.after} highlight={changedKeys(snap.before, snap.after)} />
        ) : (
          <div className="muted small">{run.nodeStatus[selected.id] === 'running' ? 'running…' : 'did not finish'}</div>
        )}
      </>
    )
  }

  if (run) {
    if (run.final) {
      return (
        <>
          <h3>Final</h3>
          <ValuesTable values={run.final} highlight={changedKeys(run.initial, run.final)} />
          <p className="muted small hint">Click a node to see its context before and after it ran.</p>
        </>
      )
    }
    return (
      <>
        <h3>At start of run</h3>
        <ValuesTable values={run.initial} />
        <p className="muted small hint">Click a node to see its context before and after it ran.</p>
      </>
    )
  }

  const inputs = start?.type === 'start' ? start.data.inputs : []
  if (inputs.length === 0) return <p className="muted small">No inputs. Select the Start node to declare some.</p>
  return (
    <>
      <h3>Inputs</h3>
      <table className="values">
        <tbody>
          {inputs.map((k) => (
            <tr key={k}>
              <td className="mono key">{k}</td>
              <td className="mono muted">{lastInputs[k] ?? '?'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
