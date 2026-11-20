import { createContext } from 'react'
import type { NodeStatus } from './types.ts'

/** Run state and validation problems, shared with node components without touching node data. */
export const CanvasState = createContext<{ status: Record<string, NodeStatus>; problems: Set<string> }>({
  status: {},
  problems: new Set(),
})
