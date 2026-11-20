import { lazy } from 'react'

const load = () => import('./CodeEditor.tsx')

export const CodeEditor = lazy(load)

/** Fetch the editor chunk ahead of time so opening a Script node doesn't wait on it. */
export function preloadCodeEditor() {
  void load()
}
