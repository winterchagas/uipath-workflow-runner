import { show } from '../engine/runner.ts'
import type { Values } from '../types.ts'

export function ValuesTable({ values, highlight, empty = 'empty' }: { values: Values; highlight?: Set<string>; empty?: string }) {
  const keys = Object.keys(values)
  if (keys.length === 0) return <div className="muted small">{empty}</div>
  return (
    <table className="values">
      <tbody>
        {keys.map((k) => (
          <tr key={k} className={highlight?.has(k) ? 'changed' : undefined}>
            <td className="mono key">{k}</td>
            <td className="mono">{show(values[k])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
