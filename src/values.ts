import { show } from './engine/runner.ts'
import type { Values } from './types.ts'

/** JSON when it parses (2 → number, true → boolean, [1] → array), otherwise the raw string. */
export function parseInput(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

/** Label for the type `parseInput` will produce, shown next to each input. */
export function inputType(raw: string): string {
  const v = parseInput(raw)
  return v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v
}

/** Keys that are new or whose value differs between two context snapshots. */
export function changedKeys(before: Values, after: Values): Set<string> {
  return new Set(Object.keys(after).filter((k) => !(k in before) || show(before[k]) !== show(after[k])))
}
