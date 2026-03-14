import type { AgentEvent } from "./agentStream"
import { isToolCallMetadata } from "./persisted-prompt"

const formatJson = (obj: unknown) => {
  if (!obj) return ''

  if (typeof obj === 'object') {
    try {
      return JSON.stringify(obj, null, 2)
    } catch {
      return ''
    }
  }
}

export const formatToolCall = (toolName: string, values: unknown[]) => {
  if (values.length === 0) {
    return `**${toolName}**`
  }
  return `**${toolName}**(${values.join(', ')})`
}

export const paramsToStringValues = (params: unknown) => {
  let values = []
  if (params != null && typeof params === 'object') {
    values = Object.values(params)
  }

  return values
}

export const formatToolContent = (event: AgentEvent) => {
  if (event.type === 'tool-call') {
    return formatToolCall(event.name, paramsToStringValues(event.params))
  }

  if (event.type === 'tool-result') {
    return `${event.name}\n\n${formatJson(event.result)}`
  }

  return ''
}

export const formatMetadata = (metadata: unknown) => {
  if (isToolCallMetadata(metadata)) {
    return formatToolCall(metadata.name, paramsToStringValues(metadata.params))
  }
  return null
}