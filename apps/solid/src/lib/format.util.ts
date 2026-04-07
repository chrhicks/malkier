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

/** Successful `read_file` tool JSON: show `data.content` as source instead of raw JSON. */
export type ReadFileToolSuccessDisplay = {
  readonly path: string
  readonly startLine: number
  readonly endLine: number
  readonly totalLines: number
  readonly truncated: boolean
  readonly content: string
}

export const parseReadFileToolSuccessDisplay = (
  toolName: string,
  payload: string,
): ReadFileToolSuccessDisplay | null => {
  if (toolName !== "read_file") {
    return null
  }

  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>
    if (parsed.status !== "success") {
      return null
    }

    const data = parsed.data
    if (data == null || typeof data !== "object") {
      return null
    }

    const record = data as Record<string, unknown>
    if (typeof record.content !== "string") {
      return null
    }

    const path = typeof record.path === "string" ? record.path : ""
    const startLine = typeof record.startLine === "number" && Number.isFinite(record.startLine) ? record.startLine : 1
    const endLine = typeof record.endLine === "number" && Number.isFinite(record.endLine) ? record.endLine : startLine
    const totalLines = typeof record.totalLines === "number" && Number.isFinite(record.totalLines) ? record.totalLines : endLine
    const truncated = record.truncated === true

    return {
      path,
      startLine,
      endLine,
      totalLines,
      truncated,
      content: record.content,
    }
  } catch {
    return null
  }
}

const applyPatchReasonLabels: Record<string, string> = {
  "missing-read-context": "Read the file first (snapshot missing).",
  "stale-read-context": "Re-read the file; snapshot is stale.",
  "patch-context-not-found": "Patch context not found in file.",
  "patch-context-ambiguous": "Patch context matched multiple places.",
  "create-not-allowed": "Cannot create files with apply_patch — use write_file.",
  "delete-not-allowed": "Cannot delete with apply_patch — use delete_file.",
  "not-implemented": "Patch operation not implemented.",
}

export const humanizeApplyPatchReason = (reason: string) =>
  applyPatchReasonLabels[reason] ?? reason.replace(/-/g, " ")

export type ApplyPatchSuccessFileRow = {
  readonly path: string
  readonly action: "updated"
  readonly addedLines: number
  readonly removedLines: number
  readonly snapshotId: string
  /** Present for new API results; omitted in older persisted sessions. */
  readonly unifiedDiff?: string
}

/** `apply_patch` tool JSON: success or guidance (structured UI instead of raw JSON). */
export type ApplyPatchToolDisplay =
  | {
      readonly kind: "success"
      readonly message: string
      readonly files: ReadonlyArray<ApplyPatchSuccessFileRow>
    }
  | {
      readonly kind: "guidance"
      readonly message: string
      readonly primaryReason: string
      readonly files: ReadonlyArray<{ readonly path: string; readonly reason: string }>
    }

const isApplyPatchSuccessFile = (value: unknown): value is ApplyPatchSuccessFileRow => {
  if (value == null || typeof value !== "object") {
    return false
  }
  const row = value as Record<string, unknown>
  if (
    typeof row.path !== "string" ||
    row.action !== "updated" ||
    typeof row.addedLines !== "number" ||
    !Number.isFinite(row.addedLines) ||
    typeof row.removedLines !== "number" ||
    !Number.isFinite(row.removedLines) ||
    typeof row.snapshotId !== "string"
  ) {
    return false
  }
  if (row.unifiedDiff != null && typeof row.unifiedDiff !== "string") {
    return false
  }
  return true
}

const isApplyPatchGuidanceFile = (value: unknown): value is { path: string; reason: string } => {
  if (value == null || typeof value !== "object") {
    return false
  }
  const row = value as Record<string, unknown>
  return typeof row.path === "string" && typeof row.reason === "string"
}

export const parseApplyPatchToolDisplay = (
  toolName: string,
  payload: string,
): ApplyPatchToolDisplay | null => {
  if (toolName !== "apply_patch") {
    return null
  }

  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>
    const message = typeof parsed.message === "string" ? parsed.message : ""
    const data = parsed.data

    if (data == null || typeof data !== "object") {
      return null
    }

    const record = data as Record<string, unknown>

    if (parsed.status === "success") {
      const filesRaw = record.files
      if (!Array.isArray(filesRaw) || filesRaw.length === 0) {
        return null
      }

      const files = filesRaw.filter(isApplyPatchSuccessFile)
      if (files.length !== filesRaw.length) {
        return null
      }

      return {
        kind: "success",
        message,
        files,
      }
    }

    if (parsed.status === "guidance") {
      const filesRaw = record.files
      if (!Array.isArray(filesRaw) || filesRaw.length === 0) {
        return null
      }

      const files = filesRaw.filter(isApplyPatchGuidanceFile)
      if (files.length !== filesRaw.length) {
        return null
      }

      const primaryReason = typeof record.reason === "string" ? record.reason : files[0]?.reason ?? "unknown"

      return {
        kind: "guidance",
        message: message || "Patch could not be applied.",
        primaryReason,
        files,
      }
    }

    return null
  } catch {
    return null
  }
}

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
