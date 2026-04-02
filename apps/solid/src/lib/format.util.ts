import type { Bubble, BubbleArgument } from "../types"
import type { AgentEvent } from "./agentStream"
import type { SessionMessage, SessionMessageRole, SessionMessageStatus } from "./sessions"
import { isStreamErrorMetadata, isToolCallMetadata, isToolResultMetadata } from "./persisted-prompt"

const titleCase = (value: string) => value.slice(0, 1).toUpperCase() + value.slice(1)

const inlineValue = (value: unknown): string => {
  if (typeof value === "string") {
    return value
  }

  if (typeof value === "number" || typeof value === "boolean" || value == null) {
    return String(value)
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const blockValue = (value: unknown): string => {
  if (typeof value === "string") {
    return value
  }

  if (typeof value === "number" || typeof value === "boolean" || value == null) {
    return String(value)
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

const eventLabelForRole = (role: SessionMessageRole) => (role === "tool" ? "Tool fault" : "Fault")

const streamReasonLabel = (reason: string) => titleCase(reason.replace(/[-_]+/g, " "))

export const humanizeToolName = (toolName: string) =>
  toolName
    .split(/[_-]+/)
    .filter((part) => part.length > 0)
    .map((part) => titleCase(part))
    .join(" ")

export const toolArgsFromParams = (params: unknown): BubbleArgument[] => {
  if (Array.isArray(params)) {
    return params.map((value, index) => ({
      label: `arg ${index + 1}`,
      value: inlineValue(value),
    }))
  }

  if (params != null && typeof params === "object") {
    return Object.entries(params).map(([label, value]) => ({
      label,
      value: inlineValue(value),
    }))
  }

  if (params == null) {
    return []
  }

  return [{ label: "value", value: inlineValue(params) }]
}

export const textBubble = (
  role: SessionMessageRole,
  text: string,
  status: SessionMessageStatus,
): Bubble => ({
  role,
  status,
  surface: {
    kind: "text",
    text,
  },
})

export const errorBubble = (role: SessionMessageRole, detail: string): Bubble => ({
  role,
  status: "error",
  surface: {
    kind: "event",
    label: eventLabelForRole(role),
    detail,
  },
})

export const bubbleFromAgentEvent = (event: AgentEvent): Bubble | null => {
  if (event.type === "tool-call") {
    return {
      role: "assistant",
      status: "complete",
      surface: {
        kind: "tool-call",
        label: humanizeToolName(event.name),
        name: event.name,
        args: toolArgsFromParams(event.params),
      },
    }
  }

  if (event.type === "tool-result") {
    return {
      role: "tool",
      status: event.isFailure ? "error" : "complete",
      surface: {
        kind: "tool-result",
        label: humanizeToolName(event.name),
        name: event.name,
        payload: blockValue(event.result),
        outcome: event.isFailure ? "failure" : "success",
      },
    }
  }

  return null
}

export const bubbleFromSessionMessage = (message: SessionMessage): Bubble => {
  if (isToolCallMetadata(message.metadata)) {
    return {
      role: message.role,
      status: message.status,
      surface: {
        kind: "tool-call",
        label: humanizeToolName(message.metadata.name),
        name: message.metadata.name,
        args: toolArgsFromParams(message.metadata.params),
      },
    }
  }

  if (isToolResultMetadata(message.metadata)) {
    return {
      role: message.role,
      status: message.metadata.isFailure ? "error" : message.status,
      surface: {
        kind: "tool-result",
        label: humanizeToolName(message.metadata.name),
        name: message.metadata.name,
        payload: blockValue(message.metadata.result),
        outcome: message.metadata.isFailure ? "failure" : "success",
      },
    }
  }

  if (message.status === "error") {
    return {
      role: message.role,
      status: message.status,
      surface: {
        kind: "event",
        label: isStreamErrorMetadata(message.metadata) ? streamReasonLabel(message.metadata.reason) : eventLabelForRole(message.role),
        detail: message.content,
      },
    }
  }

  return textBubble(message.role, message.content, message.status)
}

export const bubblesFromSessionMessages = (messages: SessionMessage[]): Bubble[] =>
  messages.map(bubbleFromSessionMessage)
