export type PersistedAssistantToolCall = {
  kind: 'assistant-tool-call'
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

export const isAssistantToolCall = (data: unknown): data is PersistedAssistantToolCall => {
  return data != null
    && typeof data === 'object'
    && 'kind' in data
    && 'params' in data
    && 'id' in data && typeof data.id === 'string'
    && 'name' in data && typeof data.name === 'string'
    && data.kind === 'assistant-tool-call'
}

export const isToolResult = (data: unknown): data is PersistedToolResult => {
  return data != null
    && typeof data === 'object'
    && 'kind' in data
    && 'result' in data
    && 'id' in data && typeof data.id === 'string'
    && 'name' in data && typeof data.name === 'string'
    && 'isFailure' in data && typeof data.isFailure === 'boolean'
    && data.kind === 'tool-result'
}

export const parsePersistedPromptMetadata = (
  metadata: string | null
): PersistedPromptMetadata | null => {
  if (metadata == null) return null

  try {
    const parsed: unknown = JSON.parse(metadata)
    if (isAssistantToolCall(parsed)) return parsed
    if (isToolResult(parsed)) return parsed
    return null
  } catch {
    return null
  }
}