export type PersistedAssistantToolCall = {
  kind: 'tool-call'
  id: string
  name: string
  params: unknown
}

export type PersistedToolResult = {
  kind: 'tool-result'
  id: string
  name: string
  result: unknown
  isFailure: boolean
}

export type PersistedAssistantOutput = {
  kind: 'assistant-output'
  state: 'partial'
  reason: PersistedStreamStopReason
}

export type PersistedStreamError = {
  kind: 'stream-error'
  reason: PersistedStreamStopReason
}

export type PersistedStreamStopReason =
  | 'agent-event-error'
  | 'stream-timeout'
  | 'stream-failure'
  | 'client-cancel'
  | 'server-interrupt'

export type PersistedPromptMetadata =
  | PersistedAssistantToolCall
  | PersistedToolResult
  | PersistedAssistantOutput
  | PersistedStreamError

export const isToolCallMetadata = (metadata: unknown): metadata is PersistedAssistantToolCall => {
  return (
    metadata != null
    && typeof metadata === 'object'
    && 'kind' in metadata
    && metadata.kind === 'tool-call'
    && 'id' in metadata
    && 'name' in metadata
    && 'params' in metadata
    && typeof metadata.id === 'string'
    && typeof metadata.name === 'string'
  )
}

export const isToolResultMetadata = (metadata: unknown): metadata is PersistedToolResult => {
  return (
    metadata != null
    && typeof metadata === 'object'
    && 'kind' in metadata
    && metadata.kind === 'tool-result'
    && 'id' in metadata
    && 'name' in metadata
    && 'result' in metadata
    && 'isFailure' in metadata
    && typeof metadata.id === 'string'
    && typeof metadata.name === 'string'
    && typeof metadata.isFailure === 'boolean'
  )
}

const isStreamStopReason = (value: unknown): value is PersistedStreamStopReason => {
  return value === 'agent-event-error'
    || value === 'stream-timeout'
    || value === 'stream-failure'
    || value === 'client-cancel'
    || value === 'server-interrupt'
}

export const isStreamErrorMetadata = (metadata: unknown): metadata is PersistedStreamError => {
  return (
    metadata != null
    && typeof metadata === 'object'
    && 'kind' in metadata
    && metadata.kind === 'stream-error'
    && 'reason' in metadata
    && isStreamStopReason(metadata.reason)
  )
}
