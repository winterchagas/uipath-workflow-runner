import type { NodeTypes } from '@xyflow/react'
import { DecisionView, EndView, ScriptView, StartView } from './nodes.tsx'

// Module-level so React Flow sees a stable object across renders.
export const nodeTypes = { start: StartView, script: ScriptView, decision: DecisionView, end: EndView } as NodeTypes
