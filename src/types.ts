import type { Edge, Node } from '@xyflow/react'

export type StartData = { name: string; inputs: string[] }
export type ScriptData = { name: string; code: string; timeoutMs: number }
export type DecisionData = { name: string; expr: string }
export type EndData = { name: string }

export type StartNode = Node<StartData, 'start'>
export type ScriptNode = Node<ScriptData, 'script'>
export type DecisionNode = Node<DecisionData, 'decision'>
export type EndNode = Node<EndData, 'end'>
export type WFNode = StartNode | ScriptNode | DecisionNode | EndNode
export type WFNodeType = WFNode['type']

export type WFEdge = Edge

export type Values = Record<string, unknown>

export type NodeStatus = 'waiting' | 'running' | 'done' | 'skipped' | 'failed' | 'cancelled'

export type TraceEntry = {
  t: number
  nodeId?: string
  kind: 'start' | 'done' | 'skipped' | 'failed' | 'cancelled' | 'decision' | 'warning' | 'run'
  message: string
}

export type LogEntry = { nodeId: string; level: 'log' | 'info' | 'warn' | 'error'; text: string }

export type RunError = { nodeId: string; message: string; line?: number }

export type RunState = {
  status: 'running' | 'done' | 'failed' | 'stopped'
  startedAt: number
  finishedAt?: number
  initial: Values
  nodeStatus: Record<string, NodeStatus>
  edgeStatus: Record<string, 'live' | 'skipped'>
  snapshots: Record<string, { before: Values; after?: Values }>
  trace: TraceEntry[]
  logs: LogEntry[]
  warnings: string[]
  endsReached: string[]
  final?: Values
  error?: RunError
}

export type Problem = { nodeId?: string; message: string }
