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

export type PersistedPromptMetadata =
  | PersistedAssistantToolCall
  | PersistedToolResult


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
    && typeof metadata.params === 'object'
    && metadata.params != null
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
    && typeof metadata.result === 'object'
    && typeof metadata.isFailure === 'boolean'
    && metadata.result != null
  )
}