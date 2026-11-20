// Runs one script or decision expression. Context keys become local variables,
// plus `ctx` for the whole (read-only) context.
import { isUsableName } from './validate.ts'

type Request = { kind: 'script' | 'expr'; code: string; ctx: Record<string, unknown> }

// Typed by hand: the project's DOM lib types `self` as Window, not a worker scope.
const scope = self as unknown as {
  postMessage(message: unknown): void
  onmessage: ((e: MessageEvent<Request>) => void) | null
}

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => (
  ...args: unknown[]
) => Promise<unknown>

// The Function constructor puts the body after a two-line header.
const HEADER_LINES = 2

const format = (v: unknown) => {
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v) ?? String(v)
  } catch {
    return String(v)
  }
}

for (const level of ['log', 'info', 'warn', 'error'] as const) {
  console[level] = (...args: unknown[]) => scope.postMessage({ type: 'log', level, text: args.map(format).join(' ') })
}

scope.onmessage = async (e: MessageEvent<Request>) => {
  const { kind, code, ctx } = e.data
  const keys = Object.keys(ctx).filter(isUsableName)
  try {
    const body = kind === 'expr' ? `return (${code}\n)` : code
    const fn = new AsyncFunction('ctx', ...keys, body)
    const result = await fn(Object.freeze({ ...ctx }), ...keys.map((k) => ctx[k]))
    try {
      scope.postMessage({ type: 'result', value: result })
    } catch {
      scope.postMessage({ type: 'error', message: 'Return value must be plain data (no functions or class instances)' })
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    const m = error.stack?.match(/(?:<anonymous>|Function):(\d+):\d+/)
    const line = m ? Number(m[1]) - HEADER_LINES : undefined
    scope.postMessage({ type: 'error', message: `${error.name}: ${error.message}`, line: line && line > 0 ? line : undefined })
  }
}
