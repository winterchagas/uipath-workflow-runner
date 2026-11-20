import type { ExecError, Executor } from './runner.ts'

/** One fresh Web Worker per script/expression, killed on timeout or cancel. */
export const workerExecutor: Executor = ({ kind, code, ctx, timeoutMs, onLog }) => {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  let timer: ReturnType<typeof setTimeout> | undefined
  let settled = false
  let reject: (e: ExecError) => void = () => {}

  const cleanup = () => {
    settled = true
    clearTimeout(timer)
    worker.terminate()
  }

  const promise = new Promise<unknown>((resolve, rej) => {
    reject = rej
    timer = setTimeout(() => {
      cleanup()
      rej({ message: `Timed out after ${timeoutMs / 1000}s` })
    }, timeoutMs)
    worker.onmessage = (e) => {
      const msg = e.data
      if (msg.type === 'log') return onLog(msg.level, msg.text)
      cleanup()
      if (msg.type === 'result') resolve(msg.value)
      else rej({ message: msg.message, line: msg.line })
    }
    worker.onerror = (e) => {
      e.preventDefault()
      cleanup()
      rej({ message: e.message || 'Worker crashed' })
    }
    worker.postMessage({ kind, code, ctx })
  })

  return {
    promise,
    cancel: () => {
      if (settled) return
      cleanup()
      reject({ message: 'Cancelled' })
    },
  }
}
