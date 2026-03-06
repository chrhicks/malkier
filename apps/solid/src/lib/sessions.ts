export type SessionStatus = "active" | "archived" | "deleted"
export type SessionMessageRole = "system" | "user" | "assistant" | "tool"
export type SessionMessageStatus = "streaming" | "complete" | "error"

export interface SessionSummary {
  readonly id: string
  readonly userId: string | null
  readonly title: string | null
  readonly status: SessionStatus
  readonly createdAt: string
  readonly updatedAt: string
}

export interface SessionMessage {
  readonly id: string
  readonly sessionId: string
  readonly role: SessionMessageRole
  readonly content: string
  readonly status: SessionMessageStatus
  readonly sequence: number
  readonly tokenCount: number | null
  readonly metadata: string | null
  readonly createdAt: string
}

export interface SessionDetail {
  readonly session: SessionSummary
  readonly messages: SessionMessage[]
}

const USER_ID_STORAGE_KEY = "malkier.user-id"
const ACTIVE_SESSION_STORAGE_KEY = "malkier.active-session-id"
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const readErrorMessage = async (response: Response) => {
  const text = await response.text()

  if (text.length === 0) {
    return `Request failed with status ${response.status}`
  }

  try {
    const parsed = JSON.parse(text) as { error?: unknown }
    if (typeof parsed.error === "string" && parsed.error.length > 0) {
      return parsed.error
    }
  } catch {
    return text
  }

  return text
}

const requestJson = async <T>(input: RequestInfo | URL) => {
  const response = await fetch(input, {
    headers: {
      accept: "application/json"
    }
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }

  return response.json() as Promise<T>
}

const formatUuid = (bytes: Uint8Array) => {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))

  return `${hex[0]}${hex[1]}${hex[2]}${hex[3]}-${hex[4]}${hex[5]}-${hex[6]}${hex[7]}-${hex[8]}${hex[9]}-${hex[10]}${hex[11]}${hex[12]}${hex[13]}${hex[14]}${hex[15]}`
}

const generateUuid = () => {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID()
  }

  const bytes = new Uint8Array(16)

  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  return formatUuid(bytes)
}

const readStoredUuid = (key: string) => {
  const stored = window.localStorage.getItem(key)
  return stored !== null && UUID_PATTERN.test(stored) ? stored : null
}

export const getStoredUserId = () => {
  const stored = readStoredUuid(USER_ID_STORAGE_KEY)

  if (stored !== null) {
    return stored
  }

  const nextUserId = generateUuid()
  window.localStorage.setItem(USER_ID_STORAGE_KEY, nextUserId)
  return nextUserId
}

export const getStoredActiveSessionId = () => readStoredUuid(ACTIVE_SESSION_STORAGE_KEY)

export const setStoredActiveSessionId = (sessionId: string | null) => {
  if (sessionId === null) {
    window.localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY)
    return
  }

  window.localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, sessionId)
}

export const listSessions = async (userId: string) => {
  const query = new URLSearchParams({ userId })
  const response = await requestJson<{ sessions: SessionSummary[] }>(`/api/sessions?${query.toString()}`)
  return response.sessions
}

export const getSession = async (userId: string, sessionId: string) => {
  const query = new URLSearchParams({ userId })
  return requestJson<SessionDetail>(`/api/sessions/${sessionId}?${query.toString()}`)
}
